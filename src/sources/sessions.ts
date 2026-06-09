// Adapter for ~/.claude/sessions/<pid>.json — Claude Code's own machine-wide
// session registry. The only schema knowledge about these files lives here.

import { readdirSync, readFileSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionInfo } from '../types';

export const SESSIONS_DIR = join(homedir(), '.claude', 'sessions');

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Parse one session file. Returns null for junk or missing required fields. */
export function parseSessionFile(raw: string): SessionInfo | null {
  let d: any;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof d?.pid !== 'number' || typeof d?.sessionId !== 'string' || typeof d?.cwd !== 'string') {
    return null;
  }
  return {
    pid: d.pid,
    sessionId: d.sessionId,
    name: typeof d.name === 'string' && d.name.length > 0 ? d.name : null,
    cwd: d.cwd,
    status: d.status === 'busy' ? 'busy' : 'idle',
    startedAt: typeof d.startedAt === 'number' ? d.startedAt : 0,
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
    kind: typeof d.kind === 'string' ? d.kind : 'unknown',
  };
}

function readAll(dir: string): SessionInfo[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: SessionInfo[] = [];
  for (const f of files) {
    try {
      const info = parseSessionFile(readFileSync(join(dir, f), 'utf8'));
      if (info) out.push(info);
    } catch {
      // file vanished mid-read — fine
    }
  }
  return out;
}

/** Live sessions only (PID responds to signal 0). */
export function readSessions(dir = SESSIONS_DIR, isAlive = pidAlive): SessionInfo[] {
  return readAll(dir).filter((s) => isAlive(s.pid));
}

/** Lingering session files whose process is gone — the `.` toggle. */
export function readStale(dir = SESSIONS_DIR, isAlive = pidAlive): SessionInfo[] {
  return readAll(dir).filter((s) => !isAlive(s.pid));
}

/** fs.watch with a 150ms debounce. Returns an unsubscribe function. */
export function watchSessions(onChange: () => void, dir = SESSIONS_DIR): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: ReturnType<typeof watch> | null = null;
  try {
    watcher = watch(dir, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 150);
    });
  } catch {
    // directory missing — caller degrades to polling via refresh keybind
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
