# Cast Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild cast as a stateless, machine-wide Claude session dashboard per `docs/superpowers/specs/2026-06-09-cast-rebuild-design.md`.

**Architecture:** Three read adapters (`~/.claude/sessions` files, transcript JSONL, cmux events/commands) merged by `model.ts` into a session tree; Ink TUI renders a dense Tufte list + detail overlay; actions go out through cmux. No server, no SQLite, no hooks.

**Tech Stack:** Bun, TypeScript, Ink 6 / React 19, commander. Tests with `bun test` + fixtures captured from the live machine; UI tests with ink-testing-library.

---

## Observed data shapes (ground truth, captured 2026-06-09)

**`~/.claude/sessions/<pid>.json`:**
```json
{"pid":12000,"sessionId":"43b9c113-…","cwd":"/Users/…","startedAt":1780865645157,
 "version":"2.1.168","kind":"interactive","entrypoint":"cli","name":"BioHub 2026",
 "updatedAt":1780865666310,"status":"idle","bridgeSessionId":null}
```
`status` ∈ {idle, busy} observed. `name` nullable.

**Transcript `~/.claude/projects/<munged-cwd>/<sessionId>.jsonl`** — munge rule: every `/`, `_`, `.`, and space in cwd → `-`. Line `type`s observed: `user`, `assistant`, `system`, `custom-title`, `last-prompt`, `agent-name`, `mode`, `permission-mode`, `bridge-session`, `attachment`, `file-history-snapshot`. Relevant:
- `assistant`: `message.content[]` blocks: `{type:'text',text}` | `{type:'tool_use',id,name,input}`. Has `isSidechain` (true = subagent traffic), `timestamp`.
- `user`: `message.content` is string OR block list incl. `{type:'tool_result',tool_use_id,…}`.
- `custom-title`: `{customTitle}` (latest wins).
- Subagent transcript `agent-<agentId>.jsonl` in the same dir: lines carry `agentId`, `sessionId` (the **parent** session), `isSidechain:true`.

**cmux events (`cmux events --reconnect`, NDJSON):**
- `agent.hook.Notification` / `agent.hook.Stop` etc: `payload.session_id` = `claude-<sessionId>` (strip prefix), `payload.cwd`, `payload.hook_event_name`, `payload.phase` ('received'|'completed'), `workspace_id`.
- `sidebar.metadata.updated`: `payload.command:'set_status'`, `payload.args` like `claude_code Running --icon=… --tab=<TAB-UUID> --panel=<PANEL-UUID> --pid=54662` → pid→tab/panel mapping + Running/Idle.
- `notification.clear_requested` etc.
- First line is `{"type":"ack",…}`; heartbeats suppressed with our flags.

**`cmux list-notifications`** line format (pipe-delimited):
`idx:NOTIF-UUID|WORKSPACE-UUID|TAB-UUID|read|<title>|<subtitle>|<body>|ISO-time|<workspace name>`
where a Claude "needs you" notification has body `Claude is waiting for your input` or `Claude needs your permission`, and `<title>` is the tab title (matches session custom name when our rename hook ran).

---

## File structure

```
src/
  types.ts                 # rewrite: new model types only
  theme.ts                 # palette, glyphs, age formatting
  sources/sessions.ts      # session-file adapter
  sources/transcripts.ts   # transcript adapter (pure parser + reader)
  sources/cmux.ts          # event stream + command wrappers (pure parsers exported)
  model.ts                 # merge, sort, pub/sub store
  actions.ts               # message / approve / deny / focus (guarded)
  ui/App.tsx               # mode switching (list | detail | filter), input routing
  ui/SessionList.tsx       # grouped list w/ NEEDS YOU band
  ui/Row.tsx               # session row + subagent micro-rows
  ui/DetailOverlay.tsx     # header, pending strip, tail, todos, composer
  ui/StatusBar.tsx         # key hints + transient action errors
  cli.ts                   # rewrite: tui (default) | list | doctor
tests/
  fixtures/                # captured real samples (sanitized)
  sessions.test.ts  transcripts.test.ts  cmux.test.ts  model.test.ts
  actions.test.ts   ui.test.tsx
DELETED at the end: src/server.ts, src/store.ts, src/components/ (Dashboard.tsx + test), scripts/*.sh
```

Parsing logic is pure functions (string/JSON in → typed data out) so tests need no fs/process mocking; thin I/O wrappers around them stay untested except by `cast doctor` and manual verification.

---

### Task 1: Types + theme

**Files:** Create `src/theme.ts`; rewrite `src/types.ts`. Test: `tests/theme.test.ts`.

- [ ] Write `src/types.ts`:

```ts
export type CoarseStatus = 'idle' | 'busy';
export type RowStatus = 'needs_you' | 'busy' | 'idle' | 'stale';

export interface SessionInfo {
  pid: number; sessionId: string; name: string | null; cwd: string;
  status: CoarseStatus; startedAt: number; updatedAt: number; kind: string;
}
export interface PendingRequest { tool: string; summary: string; since: number; }
export interface Turn { role: 'user' | 'assistant' | 'tool'; text: string; ts: number; }
export interface Todos { done: number; total: number; current: string | null; }
export interface Subagent {
  agentId: string; label: string; status: 'running' | 'done' | 'needs_you';
  updatedAt: number;
}
export interface TranscriptDetail {
  tail: Turn[]; pending: PendingRequest | null; todos: Todos | null;
  subagents: Subagent[]; customTitle: string | null;
}
export interface SurfaceRef { tab: string; panel: string | null; }
export interface Session {
  info: SessionInfo;
  row: RowStatus;
  alertSince: number | null;        // from cmux Notification / list-notifications
  detail: TranscriptDetail | null;  // lazily loaded
  surface: SurfaceRef | null;       // null => view-only
}
```

- [ ] Write `src/theme.ts` — single coral accent, glyphs, `formatAge`:

```ts
export const CORAL = '#ff6b5e';
export const GLYPH: Record<RowStatus, string> = {
  needs_you: '◐', busy: '●', idle: '○', stale: '◌',
};
export const SPINNER = ['⡿','⣟','⣯','⣷','⣾','⣽','⣻','⢿'];
export function formatAge(ms: number): string; // 3s / 12m / 4h / 2d, <0 → '0s'
```

- [ ] Test `formatAge` boundaries (59s→`59s`, 60s→`1m`, 90m→`1h`, 47h→`1d`); run `bun test tests/theme.test.ts` → PASS; commit `feat: new model types and theme`.

### Task 2: sessions adapter

**Files:** Create `src/sources/sessions.ts`, `tests/sessions.test.ts`, fixture `tests/fixtures/session-12000.json` (real sample above).

- [ ] Pure parser + liveness seam:

```ts
export function parseSessionFile(raw: string): SessionInfo | null; // validate fields, null on junk
export function readSessions(dir = SESSIONS_DIR, isAlive = pidAlive): SessionInfo[];
export function watchSessions(onChange: () => void): () => void;   // fs.watch, debounced 150ms
function pidAlive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
```
`readSessions` keeps dead-PID entries OUT of the array but exposes `readStale()` for the `.` toggle.

- [ ] Tests: parse fixture → exact fields; junk JSON → null; missing `name` → null name; `readSessions` with injected `isAlive=()=>false` returns `[]` while `readStale` returns the entry. Run → PASS. Commit `feat: session-file discovery adapter`.

### Task 3: transcript adapter

**Files:** Create `src/sources/transcripts.ts`, `tests/transcripts.test.ts`, fixtures `tests/fixtures/transcript-basic.jsonl` (hand-built from observed shapes: custom-title, user text, assistant text+tool_use, tool_result, TodoWrite tool_use, Task tool_use) and `tests/fixtures/agent-abc1234.jsonl`.

- [ ] Pure parser over the **last N lines** (read tail ~256KB max, split lines, drop first partial):

```ts
export function mungeCwd(cwd: string): string;        // /, _, ., space → '-'
export function transcriptPath(cwd: string, sessionId: string): string;
export function parseTranscript(lines: string[]): TranscriptDetail;
```
Parsing rules:
- `tail`: user text → `{role:'user'}`; assistant text → `{role:'assistant'}`; assistant tool_use → `{role:'tool', text: '<name> · <oneLine(input)>'}`. Keep last 8 non-tool turns + interleaved tool lines (cap 24 entries).
- `pending`: last assistant `tool_use` whose `id` has no later `tool_result` → `{tool, summary, since}` (excludes sidechain lines).
- `todos`: last `TodoWrite` tool_use input → counts + first `in_progress` item.
- `subagents`: `Task` tool_use inputs give `{label: input.description}`; match running state by `agent-*.jsonl` files in the same dir whose last line is recent (`updatedAt` = file mtime; `running` if matching tool_result absent, else `done`).
- `customTitle`: last `custom-title` line.
- `oneLine(input)`: Bash → `command`; Edit/Write/Read → basename of `file_path`; else first 60 chars of JSON; all squashed to one line, ellipsized at 64.

- [ ] Tests: munge (`/Users/a_b.c/x y` → `-Users-a-b-c-x-y`); pending detected then cleared by tool_result; todos counts; Task → subagent label; custom-title wins-last; junk line skipped without throw. Run → PASS. Commit `feat: transcript tail parser`.

### Task 4: cmux adapter

**Files:** Create `src/sources/cmux.ts`, `tests/cmux.test.ts`, fixture `tests/fixtures/cmux-events.ndjson` (real captured lines: ack, Notification hook, set_status, clear).

- [ ] Pure parsers:

```ts
export type CmuxEvent =
  | { kind: 'hook'; hook: string; sessionId: string; cwd: string }        // session_id 'claude-' prefix stripped
  | { kind: 'status'; pid: number; tab: string; panel: string | null; running: boolean }
  | { kind: 'notif_clear' } | { kind: 'other' };
export function parseEventLine(line: string): CmuxEvent | null;           // null for ack/heartbeat/junk
export function parseSetStatusArgs(args: string): {pid,tab,panel,running} | null; // regex over --pid/--tab/--panel + leading 'claude_code Running|Idle'
export interface CmuxNotification { tab: string; title: string; body: string; at: number; read: boolean; }
export function parseNotificationLine(line: string): CmuxNotification | null;
```

- [ ] Thin I/O (not unit-tested): `streamEvents(onEvent)` spawns `cmux events --reconnect --no-ack` via `Bun.spawn`, line-buffers stdout, auto-restarts with backoff (1s→30s), reports up/down; `listNotifications()`, `readScreen(surface)`, `send(surface, text)` (then `send-key Enter`), `sendKey(surface, key)`, `focusTab(tab)` via `tab-action --action focus --tab`, `markRead(tab)`. All return `{ok, error?}` — never throw.

- [ ] Tests over fixture lines: Notification → `{kind:'hook', sessionId:'a3822ccd-…'}`; set_status args → pid 54662 + tab uuid + running true; notification line → parsed fields; ack → null. Run → PASS. Commit `feat: cmux event/notification parsers and command wrappers`.

### Task 5: model (merge + sort + store)

**Files:** Create `src/model.ts`, `tests/model.test.ts`.

- [ ] Pure merge/sort:

```ts
export function deriveRow(info: SessionInfo, alertSince: number | null, detail: TranscriptDetail | null): RowStatus;
// needs_you if alertSince OR detail.pending OR any subagent needs_you; else busy if info.status==='busy'; else idle
export function buildTree(infos: SessionInfo[], alerts: Map<string, number>,
  details: Map<string, TranscriptDetail>, surfaces: Map<number, SurfaceRef>): Session[];
export function sortSessions(s: Session[]): { needsYou: Session[]; groups: {dir: string; label: string; sessions: Session[]}[] };
// needsYou by alert age desc; groups keyed by cwd, ordered by max(updatedAt); within: busy→idle by updatedAt desc
export function groupLabel(cwd: string): string;  // basename, UPPER_SNARLED: 'BioBrain_Rebuild' → 'BIOBRAIN_REBUILD'
```

- [ ] `CastStore` class: holds maps, applies cmux events (`hook Notification` sets alert, `hook Stop`/`notif_clear`/user-turn-in-transcript clears it, `status` updates surfaces + coarse running), exposes `snapshot()` + `subscribe(fn)`, debounced notify (50ms). Refresh policy: sessions fs.watch → re-read; selected session's transcript re-parsed on its hook events + every 2s while selected; all needs_you/busy transcripts re-parsed every 5s (cheap tail reads); idle ones on demand.

- [ ] Tests: alert bubbles from subagent; group ordering by recency; needs-you sorted longest-wait-first; Stop clears alert. Run → PASS. Commit `feat: merged session model and store`.

### Task 6: actions with guards

**Files:** Create `src/actions.ts`, `tests/actions.test.ts`.

- [ ] Pure guard + thin executors:

```ts
export function screenShowsPrompt(screen: string): boolean;
// true if visible text matches /Do you want|Allow .+\?|❯ 1\. Yes|y\/n|Waiting for your input|esc to interrupt.*\?/i — tuned against real read-screen captures during manual verify
export async function approve(s: Session, deps): Promise<ActionResult>   // guard: readScreen → screenShowsPrompt; then sendKey 'y'
export async function deny(s: Session, deps): Promise<ActionResult>      // same, 'n'
export async function message(s: Session, text: string, deps): Promise<ActionResult> // send text + Enter
export async function focus(s: Session, deps): Promise<ActionResult>
```
`ActionResult = {ok:true} | {ok:false, reason:string}`; no surface → `{ok:false, reason:'view-only · not in cmux'}`.

- [ ] Tests with stubbed deps: approve refuses when screen lacks prompt; approve sends `y` when present; message on surfaceless session refuses. Run → PASS. Commit `feat: guarded session actions`.

### Task 7: UI

**Files:** Create `src/ui/{App,SessionList,Row,DetailOverlay,StatusBar}.tsx`, `tests/ui.test.tsx`. Dep: `bun add ink-testing-library -d` (already present).

- [ ] `Row.tsx`: `[glyph] name.padEnd(nameW) [spinner] age.padStart(4) context` — coral glyph+name for needs_you, dim gray context for idle, cyan spinner frame from shared tick. Subagent micro-rows indented `  ├/└ ` with own glyph + label + age; collapsed chip `+N✓` when all done.
- [ ] `SessionList.tsx`: header stat line (`cast · 3 need you · …`), coral `── NEEDS YOU ──…` rule when nonempty, dim group rules `── LABEL · n ──…`, selection = inverse video on name, viewport scrolling (keep selection visible), `/` filter applies substring on name+group.
- [ ] `DetailOverlay.tsx`: header (name, ~-abbreviated cwd, pid, status+age), coral PENDING strip only when pending, tail rendering (`me›` bold / `cl›` normal / `⚒` dim tool lines, wrapped to width), dim todos line, bottom composer (ink-text-input) always focusable via `m`.
- [ ] `App.tsx`: state machine `{mode: 'list'|'detail'|'filter', selected, composerFocus}`; `useInput` routing per spec keybindings (`jk⇅ ⏎ m y n g / x . esc q`); subscribes to store; 8fps spinner tick only while any busy row visible.
- [ ] `StatusBar.tsx`: context-sensitive hints; transient coral error line (5s) from last failed action.
- [ ] ink-testing-library tests with a fixture store snapshot: renders NEEDS YOU band before groups; needs_you row contains pending summary; subagent micro-row renders; filter narrows rows; y on promptless session shows refusal in status bar (stubbed actions). Run → PASS. Commit `feat: dense list UI and detail overlay`.

### Task 8: CLI + wiring

**Files:** Rewrite `src/cli.ts`; modify `package.json` (`"bin": {"cast": "src/cli.ts"}`, scripts).

- [ ] `cast` (default): construct store (sessions watch + cmux stream + initial `list-notifications`), render `<App/>`; on cmux stream down → store flag → StatusBar shows `cmux offline · read-only` dim banner.
- [ ] `cast list`: TSV `pid sessionId status name cwd age` to stdout.
- [ ] `cast doctor`: checks — sessions dir readable + count; transcript resolvable for ≥1 session; `cmux ping`; events stream yields a line within 3s; prints ✓/✗ per check, exit 1 on any ✗.
- [ ] Commit `feat: cli with tui, list, doctor`.

### Task 9: legacy removal + docs + manual verification

- [ ] Delete `src/server.ts`, `src/store.ts`, `src/components/`, `scripts/*.sh`, `index.ts` stub; `bun test` still green.
- [ ] Rewrite `README.md` (new architecture, zero-install quick start, keybindings table, data sources, failure modes) and update `CLAUDE.md` structure section.
- [ ] Manual verification on the live machine (use superpowers:verification-before-completion):
  - `cast list` count ≈ live session count; names match `/name` titles.
  - `cast doctor` all ✓.
  - TUI: groups render, this session shows busy with activity.
  - Trigger a real permission prompt in a scratch session → row goes coral with request summary; `y` approves it; guard refuses `y` on a session with no prompt.
  - `m` send "say hi" to a scratch idle session → message lands and runs.
  - `g` focuses the right cmux tab.
- [ ] Commit `feat: cast 2.0 — stateless machine-wide dashboard`; final commit removing anything dead.

---

## Self-review notes

- Spec coverage: discovery (T2), transcripts/pending/todos/subagents (T3), cmux events/actions/mapping (T4), merge/sort/alert lifecycle (T5), guarded actions (T6), full TUI incl. filter/stale toggle/view-only rows (T7), CLI+doctor+read-only degradation (T8), deletion/docs/manual checks (T9). ✔
- Names consistent: `Session`, `TranscriptDetail`, `SurfaceRef`, `CastStore`, `ActionResult` used uniformly. ✔
- `screenShowsPrompt` regex is explicitly flagged for tuning against real `read-screen` output during T9 manual verification — listed as such, not a placeholder.
