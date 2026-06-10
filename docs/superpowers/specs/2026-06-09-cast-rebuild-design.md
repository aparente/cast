# Cast Rebuild — Machine-Wide Claude Session Dashboard
**Date:** 2026-06-09 **Status:** Approved design, pending implementation plan
## Goal
Rebuild cast as a terminal dashboard that monitors and controls **every** running Claude Code session on the machine, regardless of working directory. Replace the hook → HTTP server → SQLite pipeline with stateless readers over data Claude Code and cmux already maintain. Preserve the useful UX ideas from the `claude agents` dashboard (per-agent detail, direct messaging, pending permission requests) while being visually distinct and denser, following Tufte principles.
## Why the old architecture goes away
- Claude Code now writes `~/.claude/sessions/<pid>.json` for every session (interactive or not, any directory) with `sessionId`, `cwd`, `name` (the `/name` custom title), `status` (`idle`/`busy`), `startedAt`, `updatedAt`. This supersedes cast's hook-based discovery and SQLite registry — and it never goes stale, because liveness is just a PID check.
  
- cmux already receives Claude Code hook events through its own hooks integration. `cmux events --reconnect` streams them live (`agent.hook.Notification`, sidebar `set_status claude_code Running --pid … --tab …`, notification clears). Cast's five hook scripts and HTTP server duplicated this.
  
- The `claude agents` dashboard is built on team/daemon infrastructure (`~/.claude/daemon/roster.json`) and only sees agents in the current project's team. Cast's niche is machine-wide interactive sessions — different data source entirely.
  
## Architecture: stateless reader + cmux control plane
No server. No database. No hooks of our own. Full state is re-derivable from disk and cmux within ~1s of startup, so restarts lose nothing.
### Data sources (one adapter module each — schema drift breaks one file)
`sources/sessions.ts` — discovery and coarse status. Reads `~/.claude/sessions/*.json`; `fs.watch` on the directory. Filters to live PIDs (`process.kill(pid, 0)`). Emits:

```ts
interface SessionInfo {
  pid: number;
  sessionId: string;
  name: string | null;     // custom /name title
  cwd: string;
  status: 'idle' | 'busy';
  startedAt: number;
  updatedAt: number;
  kind: string;             // 'interactive' etc.
}
```

`sources/transcripts.ts` — rich per-session detail, read lazily/tailed. Maps `cwd` + `sessionId` → `~/.claude/projects/<munged-cwd>/<sessionId>.jsonl` (munging: `/` and `_` → `-`, observed convention). Extracts:

- Conversation tail: last ~8 user/assistant turns (text snippets, tool calls).
  
- Pending request: a trailing `tool_use` without a corresponding result while the session waits — gives tool name + one-line input summary.
  
- TodoWrite progress: latest todos state (`done/total`, current item).
  
- Subagents: Task tool invocations and their `agent-<id>.jsonl` sidecar files in the same project directory → subagent label, running/done, last activity.
  

`sources/cmux.ts` — live events + actions.

- One long-lived `cmux events --reconnect` subprocess. Consumed events: `agent.hook.*` (Notification = needs-input, Stop = turn ended, keyed by `session_id`/`cwd`), `sidebar.metadata.updated` `set_status` (PID → tab/panel mapping, running/idle), `notification.*` (alert lifecycle).
  
- On-demand commands: `list-notifications` (initial alert state), `read-screen --surface` (live prompt text and action guard), `send` / `send-key` (messaging, approve/deny), `tab-action --action focus` / `focus-pane` (jump to session), `mark-notification-read` (clear handled alerts).
  
- PID → surface mapping: primary from `set_status --pid --tab --panel` events; fallback by reading `CMUX_SURFACE_ID` from the claude process environment (`ps eww <pid>`).
  

`model.ts` — merges the three sources into one session tree (`Session { info, alert?, pending?, tail?, todos?, subagents[], surface? }`), applies sorting, exposes subscribe/snapshot to the UI.
### Actions (`actions.ts`)
- **Message**: `cmux send --surface <id> <text>` then Enter key. Works whether the session is idle (starts a turn) or busy (queues in the input buffer).
  
- **Approve / deny**: `send-key y` / `send-key n` — **guarded**: first `read-screen` the surface and verify a permission prompt is actually visible; if not, refuse, refresh state, and say why. Never type blind keystrokes into a live session.
  
- **Focus**: `tab-action --action focus` on the session's tab.
  
- Non-cmux sessions (no surface mapping): rows render normally but actions are disabled and shown dim ("view-only · not in cmux").
  
## TUI design
**Direction:** quiet monochrome density, single coral accent. The data is the interface: no row borders, no kanban, no emoji, no decorative status verbs. Color budget — grayscale for structure, coral `#ff6b5e` exclusively for needs-you, dim cyan braille spinner for busy. Distinct from both old cast (playful/kanban) and `claude agents`.
### List view (default, full width)
```
cast · 3 need you · 12 busy · 32 idle · 47 sessions
── NEEDS YOU ───────────────────────────────────────────────────
◐ ARIA Proposals SCENT   12m  Bash · rm -rf node_modules && bun install
◐ Travel                  2h  "Which dates work for the Chicago trip?"
── BIOBRAIN_REBUILD · 28 ───────────────────────────────────────
● Gene-Linking       ⡿    3s  Searching ontology files for GO terms
  ├ ● explore: map MOC links              2m
  └ ◐ verify: check 40 tagged notes       8m
○ BioHub 2026             4h  retagged regen-med notes (dim)
── GITHUB_REPOSITORIES · 6 ─────────────────────────────────────
● Cast Rebuild       ⣻    1s  Editing src/components/Dashboard.tsx
⇅ nav · ⏎ detail · m msg · y/n approve · g go to tab · / filter · q
```

- **Row anatomy:** status glyph · name · spinner (busy only) · right-aligned compact age (`3s/12m/4h/2d` since `updatedAt`) · context column.
  
- **Context column:** needs-you rows show the pending request (tool + one-line summary); busy rows show current activity from the transcript; idle rows show last activity in dim gray (information present, near-zero visual weight).
  
- **Glyphs:** `◐` needs-you (coral glyph + name) · `●` busy · `○` idle · `◌` stale (file present, PID dead — hidden behind `.` toggle).
  
- **Subagents:** tree micro-rows (`├ └`) with label, status glyph, age. Auto-expanded while any child is alive; collapsed to a dim count chip (`+3✓`) when all done. Parent goes coral if any child needs input. `x` toggles expansion globally.
  
- **Grouping/sorting:** NEEDS YOU band first, sorted by wait time descending. Then groups by project directory (dim header with count), groups ordered by most recent activity; within group busy → idle, each by recency.
  
### Detail overlay (`⏎`; `Esc` returns to list position)
```
ARIA Proposals SCENT     ~/Obsidian_Vaults/BioBrain_Rebuild · pid 11582 · idle 12m

◐ PENDING  Bash · rm -rf node_modules && bun install      [y] approve · [n] deny
──────────────────────────────────────────────────────────────────
 me› retag the regen-med notes per the new ontology
 cl› Tightened tagging on 40 notes, 78 engaged. Running verification…
 cl› ⚒ Bash · grep -c 'regen-med' notes/**/*.md
todos 4/7 · current: regenerate charts
──────────────────────────────────────────────────────────────────
 › type message, ⏎ sends · esc back · g go to tab
```

- Pending strip only renders when a request is actually pending (coral).
  
- Tail: last ~8 turns, `me›`/`cl›` prefixes, tool calls as single dim `⚒` lines. Todos line only when todos exist.
  
- Composer always available at the bottom; `m` from the list jumps straight into it.
  
### Keybindings
| Key | Context | Action |
| --- | --- | --- |
| `⇅` / `jk` | list | navigate |
| `⏎` | list | open detail overlay |
| `m` | list/detail | focus composer for selected session |
| `y` / `n` | list/detail | approve/deny pending request (guarded) |
| `g` | list/detail | focus the session's cmux tab |
| `/` | list | filter by name/project |
| `x` | list | toggle subagent rows |
| `.` | list | show/hide stale sessions |
| `Esc` | detail/filter | back |
| `q` | list | quit |
## CLI
- `cast` — the TUI (default).
  
- `cast list` — plain TSV of sessions for scripting.
  
- `cast doctor` — checks each data source (session files readable, cmux reachable, events stream connects, hook events flowing) and reports.
  

Removed commands: `server`, `clear`, `prune`, `install-hooks` (obsolete with no server/db/hooks).
## Failure modes
- cmux unreachable → read-only mode; one dim banner line; list still fully works from session files + transcripts.
  
- Unparseable transcript line → skip the line; a row never crashes the TUI.
  
- PID dead, session file lingering → `◌` stale, hidden by default.
  
- Action failure (send error, guard refusal) → coral message in status bar; never silent.
  
- Schema drift in any source → contained to its adapter; adapters validate shape and degrade per-field (missing `name` → derive from cwd basename).
  
## File changes
```
src/
  cli.ts               # rewrite: tui | list | doctor
  model.ts             # new: merged tree, sorting, pub/sub
  sources/sessions.ts  # new
  sources/transcripts.ts # new
  sources/cmux.ts      # new
  actions.ts           # new
  ui/App.tsx ui/SessionList.tsx ui/Row.tsx ui/DetailOverlay.tsx
  ui/Composer.tsx ui/theme.ts   # new (replaces Dashboard.tsx)
```

Deleted: `src/server.ts`, `src/store.ts`, `src/components/Dashboard.tsx` (+test), `scripts/*.sh`, SQLite database usage. `~/.claude/settings.json` has no cast hooks installed, so there is nothing to uninstall.
## Testing
- `bun test` unit tests per adapter using fixture files captured from the real system (session JSON, transcript JSONL with tool_use/Task/TodoWrite lines, cmux event lines).
  
- `model.ts` merge + sort tests (alert bubbling from subagents, group ordering).
  
- ink-testing-library render tests of the list against fixture state.
  
- Manual verification against the live machine (~47 sessions): discovery count, alert appears on a real permission prompt, message lands in a session, guarded y/n refuses when no prompt is visible.
  
## Out of scope (explicitly)
- VS Code / iTerm2 / tmux action backends (non-cmux sessions are view-only).
  
- Persistence, history, or analytics across restarts.
  
- Spawning new sessions from cast.
  
- The daemon/teams agent infrastructure (`claude agents`' domain).
