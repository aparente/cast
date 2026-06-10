// Core model types for cast — see docs/superpowers/specs/2026-06-09-cast-rebuild-design.md

export type CoarseStatus = 'idle' | 'busy';
export type RowStatus = 'needs_you' | 'busy' | 'idle' | 'stale';

/** Parsed from ~/.claude/sessions/<pid>.json — written by Claude Code itself. */
export interface SessionInfo {
  pid: number;
  sessionId: string;
  name: string | null; // custom /name title
  cwd: string;
  status: CoarseStatus;
  startedAt: number;
  updatedAt: number;
  kind: string; // 'interactive' etc.
}

export interface PendingRequest {
  tool: string;
  summary: string;
  since: number;
}

export interface Turn {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  ts: number;
}

export interface Todos {
  done: number;
  total: number;
  current: string | null;
}

export interface Subagent {
  agentId: string;
  label: string;
  status: 'running' | 'done' | 'needs_you';
  updatedAt: number;
}

/** Lazily parsed from the session's transcript JSONL tail. */
export interface TranscriptDetail {
  tail: Turn[];
  pending: PendingRequest | null;
  todos: Todos | null;
  subagents: Subagent[];
  customTitle: string | null;
}

/**
 * Where the session lives in cmux: its workspace id (UUID or `workspace:N`
 * ref — both accepted by `--workspace=`). Used for send/read-screen/select.
 * null workspace ⇒ view-only row.
 */
export interface SurfaceRef {
  workspace: string | null;
}

export interface Session {
  info: SessionInfo;
  row: RowStatus;
  alertSince: number | null;
  detail: TranscriptDetail | null;
  surface: SurfaceRef | null;
}

export type ActionResult = { ok: true } | { ok: false; reason: string };
