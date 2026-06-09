// Merges the three sources (session files, transcripts, cmux) into one
// sorted session tree and keeps it fresh. Pure derivation functions are
// exported for tests; CastStore owns the mutable maps and refresh policy.

import type {
  RowStatus,
  Session,
  SessionInfo,
  SurfaceRef,
  TranscriptDetail,
} from './types';
import type { CmuxEvent, CmuxNotification } from './sources/cmux';
import { isNeedsYou } from './sources/cmux';

// ── pure derivation ─────────────────────────────────────────────────────

export function deriveRow(
  info: SessionInfo,
  alertSince: number | null,
  detail: TranscriptDetail | null,
): RowStatus {
  // An explicit notification outranks busy: permission prompts arrive
  // mid-turn while the session file still reads 'busy'.
  if (alertSince !== null) return 'needs_you';
  if (detail?.subagents.some((s) => s.status === 'needs_you')) return 'needs_you';
  // A pending tool_use only signals needs-you when the session is idle —
  // while busy it just means a tool is executing.
  if (detail?.pending && info.status === 'idle') return 'needs_you';
  return info.status === 'busy' ? 'busy' : 'idle';
}

export function groupLabel(cwd: string): string {
  const base = cwd.split('/').filter(Boolean).pop() ?? cwd;
  return base.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

export function buildSessions(
  infos: SessionInfo[],
  alerts: Map<string, number>,
  details: Map<string, TranscriptDetail>,
  surfaces: Map<number, SurfaceRef>,
): Session[] {
  return infos.map((info) => {
    const alertSince = alerts.get(info.sessionId) ?? null;
    const detail = details.get(info.sessionId) ?? null;
    return {
      info,
      alertSince,
      detail,
      surface: surfaces.get(info.pid) ?? null,
      row: deriveRow(info, alertSince, detail),
    };
  });
}

export interface Grouped {
  needsYou: Session[];
  groups: { dir: string; label: string; sessions: Session[] }[];
  counts: { needsYou: number; busy: number; idle: number; total: number };
}

export function sortSessions(all: Session[]): Grouped {
  const needsYou = all
    .filter((s) => s.row === 'needs_you')
    .sort((a, b) => (a.alertSince ?? a.info.updatedAt) - (b.alertSince ?? b.info.updatedAt));

  const rest = all.filter((s) => s.row !== 'needs_you');
  const byDir = new Map<string, Session[]>();
  for (const s of rest) {
    const list = byDir.get(s.info.cwd) ?? [];
    list.push(s);
    byDir.set(s.info.cwd, list);
  }
  const groups = [...byDir.entries()]
    .map(([dir, sessions]) => ({
      dir,
      label: groupLabel(dir),
      sessions: sessions.sort((a, b) => {
        if (a.row !== b.row) return a.row === 'busy' ? -1 : 1;
        return b.info.updatedAt - a.info.updatedAt;
      }),
    }))
    .sort(
      (a, b) =>
        Math.max(...b.sessions.map((s) => s.info.updatedAt)) -
        Math.max(...a.sessions.map((s) => s.info.updatedAt)),
    );

  return {
    needsYou,
    groups,
    counts: {
      needsYou: needsYou.length,
      busy: all.filter((s) => s.row === 'busy').length,
      idle: all.filter((s) => s.row === 'idle').length,
      total: all.length,
    },
  };
}

// ── live store ──────────────────────────────────────────────────────────

export interface StoreDeps {
  readSessions: () => SessionInfo[];
  readDetail: (cwd: string, sessionId: string) => TranscriptDetail | null;
  now?: () => number;
}

export class CastStore {
  private infos: SessionInfo[] = [];
  private alerts = new Map<string, number>();
  private details = new Map<string, TranscriptDetail>();
  private surfaces = new Map<number, SurfaceRef>();
  private tabToPid = new Map<string, number>();
  private listeners = new Set<() => void>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  cmuxUp = false;

  constructor(private deps: StoreDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const fn of this.listeners) fn();
    }, 50);
  }

  setCmuxUp(up: boolean): void {
    if (this.cmuxUp !== up) {
      this.cmuxUp = up;
      this.notify();
    }
  }

  refreshSessions(): void {
    this.infos = this.deps.readSessions();
    this.notify();
  }

  refreshDetail(sessionId: string): void {
    const info = this.infos.find((i) => i.sessionId === sessionId);
    if (!info) return;
    const detail = this.deps.readDetail(info.cwd, info.sessionId);
    if (!detail) return;
    this.details.set(sessionId, detail);
    // Self-heal stale alerts: activity after the alert with nothing pending
    // means the user already handled it in the tab.
    const since = this.alerts.get(sessionId);
    if (since !== undefined && !detail.pending) {
      const lastTs = Math.max(0, ...detail.tail.map((t) => t.ts));
      if (lastTs > since) this.alerts.delete(sessionId);
    }
    this.notify();
  }

  /** Refresh transcripts for every session that is (or may become) hot. */
  refreshHotDetails(): void {
    for (const s of this.snapshotAll()) {
      if (s.row === 'needs_you' || s.row === 'busy') this.refreshDetail(s.info.sessionId);
    }
  }

  applyEvent(e: CmuxEvent): void {
    if (e.kind === 'hook') {
      if (e.hook === 'Notification') {
        this.alerts.set(e.sessionId, this.now());
      } else {
        // Any other hook means the session moved — the alert was handled.
        this.alerts.delete(e.sessionId);
      }
      this.refreshDetail(e.sessionId);
      this.notify();
    } else if (e.kind === 'status') {
      this.surfaces.set(e.pid, { tab: e.tab, panel: e.panel });
      this.tabToPid.set(e.tab, e.pid);
      this.notify();
    } else if (e.kind === 'notif_clear') {
      this.notify();
    }
  }

  /** Seed alerts from unread needs-you notifications (startup catch-up). */
  seedNotifications(ns: CmuxNotification[]): void {
    for (const n of ns) {
      if (n.read || !isNeedsYou(n)) continue;
      const pid = this.tabToPid.get(n.tab);
      const info = pid !== undefined ? this.infos.find((i) => i.pid === pid) : undefined;
      if (info && !this.alerts.has(info.sessionId)) {
        this.alerts.set(info.sessionId, n.at || this.now());
      }
    }
    this.notify();
  }

  /** Map surfaces for sessions cmux hasn't announced since we started. */
  seedSurface(pid: number, surface: SurfaceRef): void {
    this.surfaces.set(pid, surface);
    this.tabToPid.set(surface.tab, pid);
  }

  snapshotAll(): Session[] {
    return buildSessions(this.infos, this.alerts, this.details, this.surfaces);
  }

  snapshot(): Grouped & { cmuxUp: boolean } {
    return { ...sortSessions(this.snapshotAll()), cmuxUp: this.cmuxUp };
  }
}
