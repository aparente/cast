// Adapter for cmux: the live event stream (push) and command wrappers
// (actions + queries). All cmux schema knowledge lives here. Parsers are
// pure; I/O wrappers never throw — they return {ok, error?}.

import type { SurfaceRef } from '../types';

// ── event stream parsing ────────────────────────────────────────────────

export type CmuxEvent =
  | { kind: 'hook'; hook: string; sessionId: string; cwd: string }
  | { kind: 'status'; pid: number; tab: string; panel: string | null; running: boolean }
  | { kind: 'notif_clear' }
  | { kind: 'other' };

/** Parse `set_status` args like:
 *  `claude_code Running --icon=bolt.fill --tab=<UUID> --panel=<UUID> --pid=54662` */
export function parseSetStatusArgs(
  args: string,
): { pid: number; tab: string; panel: string | null; running: boolean } | null {
  if (!args.startsWith('claude_code ')) return null;
  const pid = args.match(/--pid=(\d+)/)?.[1];
  const tab = args.match(/--tab=([0-9A-Fa-f-]+)/)?.[1];
  if (!pid || !tab) return null;
  return {
    pid: Number(pid),
    tab,
    panel: args.match(/--panel=([0-9A-Fa-f-]+)/)?.[1] ?? null,
    running: /^claude_code Running\b/.test(args),
  };
}

/** Parse one NDJSON line from `cmux events`. Null for ack/heartbeat/junk. */
export function parseEventLine(line: string): CmuxEvent | null {
  let d: any;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if (d?.type !== 'event') return null;

  if (typeof d.name === 'string' && d.name.startsWith('agent.hook.')) {
    if (d.payload?.phase !== 'received') return { kind: 'other' };
    const raw = String(d.payload?.session_id ?? '');
    return {
      kind: 'hook',
      hook: d.name.slice('agent.hook.'.length),
      sessionId: raw.replace(/^claude-/, ''),
      cwd: String(d.payload?.cwd ?? ''),
    };
  }
  if (d.name === 'sidebar.metadata.updated' && d.payload?.command === 'set_status') {
    const parsed = parseSetStatusArgs(String(d.payload?.args ?? ''));
    return parsed ? { kind: 'status', ...parsed } : { kind: 'other' };
  }
  if (d.name === 'notification.clear_requested') return { kind: 'notif_clear' };
  return { kind: 'other' };
}

// ── list-notifications parsing ──────────────────────────────────────────

export interface CmuxNotification {
  tab: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
}

/** Lines look like:
 *  `1:<NOTIF-UUID>|<WORKSPACE-UUID>|<TAB-UUID>|unread|<title>|<subtitle>|<body>|<ISO>|<workspace>` */
export function parseNotificationLine(line: string): CmuxNotification | null {
  const m = line.match(/^\d+:(.*)$/);
  if (!m) return null;
  const parts = m[1]!.split('|');
  if (parts.length < 8) return null;
  const [, , tab, readState, title, , body, iso] = parts;
  if (!tab) return null;
  return {
    tab,
    title: title ?? '',
    body: body ?? '',
    at: Date.parse(iso ?? '') || 0,
    read: readState === 'read',
  };
}

/** True for the notifications that mean a session needs the user. */
export function isNeedsYou(n: CmuxNotification): boolean {
  return /waiting for your input|needs your permission/i.test(n.body);
}

// ── thin I/O wrappers ───────────────────────────────────────────────────

type RunResult = { ok: true; stdout: string } | { ok: false; error: string };

async function run(args: string[], timeoutMs = 4000): Promise<RunResult> {
  try {
    const proc = Bun.spawn(['cmux', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    clearTimeout(timer);
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return { ok: false, error: stderr.trim() || `cmux exited ${code}` };
    }
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function ping(): Promise<boolean> {
  return (await run(['ping'])).ok;
}

export async function listNotifications(): Promise<CmuxNotification[]> {
  const r = await run(['list-notifications']);
  if (!r.ok) return [];
  return r.stdout.split('\n').map(parseNotificationLine).filter((n): n is CmuxNotification => n !== null);
}

const NO_SURFACE: RunResult = { ok: false, error: 'no terminal surface for session' };

export async function readScreen(ref: SurfaceRef): Promise<string | null> {
  if (!ref.surface) return null;
  const r = await run(['read-screen', `--surface=${ref.surface}`]);
  return r.ok ? r.stdout : null;
}

export async function send(ref: SurfaceRef, text: string): Promise<RunResult> {
  if (!ref.surface) return NO_SURFACE;
  const sent = await run(['send', `--surface=${ref.surface}`, text]);
  if (!sent.ok) return sent;
  return run(['send-key', `--surface=${ref.surface}`, 'Enter']);
}

export async function sendKey(ref: SurfaceRef, key: string): Promise<RunResult> {
  if (!ref.surface) return NO_SURFACE;
  return run(['send-key', `--surface=${ref.surface}`, key]);
}

export async function focusTab(ref: SurfaceRef): Promise<RunResult> {
  if (ref.tab) return run(['tab-action', '--action=focus', `--tab=${ref.tab}`]);
  if (ref.surface) return run(['tab-action', '--action=focus', `--surface=${ref.surface}`]);
  return NO_SURFACE;
}

/** Read CMUX_SURFACE_ID from a process's environment (macOS `ps -wwE`). */
export async function surfaceFromEnv(pid: number): Promise<string | null> {
  try {
    const proc = Bun.spawn(['ps', '-p', String(pid), '-wwE', '-o', 'command='], { stdout: 'pipe' });
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    return out.match(/CMUX_SURFACE_ID=([0-9A-Fa-f-]{36})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

// ── event stream (long-lived subprocess with backoff restart) ───────────

export interface StreamHandle {
  stop: () => void;
}

export function streamEvents(
  onEvent: (e: CmuxEvent) => void,
  onState: (up: boolean) => void,
): StreamHandle {
  let stopped = false;
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let backoff = 1000;

  const start = async () => {
    if (stopped) return;
    try {
      proc = Bun.spawn(['cmux', 'events', '--reconnect', '--no-ack'], {
        stdout: 'pipe',
        stderr: 'ignore',
      });
      onState(true);
      backoff = 1000;
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = parseEventLine(line);
          if (e) onEvent(e); // 'other' included — consumers no-op on it
        }
      }
    } catch {
      // fall through to restart
    }
    if (!stopped) {
      onState(false);
      setTimeout(start, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }
  };

  start();
  return {
    stop: () => {
      stopped = true;
      proc?.kill();
    },
  };
}
