# Claude Session Manager - Development Handoff

This document captures all architectural decisions, implementation details, and next steps for continuing development.

## Project Context

**Goal**: A terminal UI to manage multiple concurrent Claude Code sessions, inspired by [claude-canvas](https://github.com/dvdsgl/claude-canvas) TUI patterns.

**User workflow**: Running 5-7 Claude Code sessions simultaneously in VS Code terminals. Needs to know which sessions need attention without context-switching constantly.

**Design principles**:
- "Little bits of design delight" — playful, game-like feel
- Terminal-agnostic (works in VS Code, tmux, iTerm2)
- Low-friction setup with Claude Code hooks

## Current State (as of handoff)

### What's Working

1. **Dashboard TUI** (`src/components/Dashboard.tsx`)
   - List view with session rows
   - Kanban view with columns (Needs You / Busy / Chilling)
   - Detail view with session info
   - Animated spinners for working sessions
   - Walking crab animation on empty state

2. **Hook System** (`scripts/*.sh`)
   - `session-start.sh` — Registers session with terminal context
   - `session-end.sh` — Removes session
   - `notification.sh` — Sets alerting state (Claude needs input)
   - `tool-use.sh` — Clears alert, updates status to working
   - `user-prompt.sh` — Ensures session is registered on any message

3. **Server** (`src/server.ts`)
   - HTTP server on port 7432
   - `POST /event` — Receives hook events
   - `POST /action` — Sends quick actions (tmux only)
   - `GET /sessions` — Lists all sessions
   - `GET /health` — Health check

4. **Persistence** (`src/store.ts`)
   - SQLite database at `~/.claude-session-manager.db`
   - Sessions survive dashboard restarts
   - In-memory cache for fast reads
   - Pub/sub for UI updates

5. **Quick Actions** (tmux only)
   - `y` to approve (sends "y" + Enter)
   - `n` to deny (sends "n" + Enter)
   - `r` to type custom response
   - Uses `tmux send-keys -t <pane>`

### File Structure

```
claude-session-manager/
├── src/
│   ├── cli.ts              # CLI entry point with Commander.js
│   ├── server.ts           # HTTP server for hook events
│   ├── store.ts            # SQLite-backed session store
│   ├── types.ts            # TypeScript types
│   └── components/
│       └── Dashboard.tsx   # Main Ink TUI component
├── scripts/
│   ├── session-start.sh    # Hook: SessionStart
│   ├── session-end.sh      # Hook: SessionEnd
│   ├── notification.sh     # Hook: Notification
│   ├── tool-use.sh         # Hook: PostToolUse
│   └── user-prompt.sh      # Hook: UserPromptSubmit
├── CLAUDE.md               # Project conventions for AI assistants
├── README.md               # User documentation
└── HANDOFF.md              # This file
```

### Key Types

```typescript
// Session status
type SessionStatus = 'idle' | 'working' | 'needs_input' | 'error' | 'completed';

// Terminal context for quick actions
interface TerminalContext {
  type: 'tmux' | 'vscode' | 'iterm2' | 'unknown';
  id: string;           // tmux pane target, iTerm session ID, etc.
  shellPid?: number;
  ttyPath?: string;
}

// Full session object
interface ClaudeSession {
  id: string;
  name: string;
  status: SessionStatus;
  projectPath?: string;
  currentTask?: string;
  pendingMessage?: string;
  lastActivity: Date;
  alerting: boolean;
  terminal: TerminalContext;
}
```

### Hook Data Flow

1. Claude Code fires hook event
2. Hook script receives JSON on stdin:
   ```json
   {
     "session_id": "abc123",
     "cwd": "/path/to/project",
     "hook_event_name": "SessionStart"
   }
   ```
3. Script extracts fields and detects terminal context
4. Script POSTs to `http://localhost:7432/event`
5. Server updates SQLite + cache
6. Store notifies subscribers
7. React component re-renders

## Completed Feature: Subagent Tree View

### What Was Implemented

1. **Parent-child tracking** via `parentId` field on sessions
2. **Expandable tree rows** with ▼/▶ indicators
3. **Status bubbling** — if any child needs input, parent shows "!" indicator
4. **Keyboard navigation** — ←/→ to collapse/expand, Enter toggles tree, Space opens detail

### Data Model

```typescript
interface ClaudeSession {
  // ... existing fields
  parentId?: string;  // If this is a subagent, the parent's session ID
}

interface AggregatedStatus {
  status: SessionStatus;
  alerting: boolean;
  childCount: number;
  alertingChildCount: number;
}
```

SQLite migration (auto-applied):
```sql
ALTER TABLE sessions ADD COLUMN parent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_parent_id ON sessions(parent_id);
```

### Store Methods Added

- `getChildren(parentId)` — Get direct children of a session
- `getRootSessions()` — Get sessions without parents
- `getAggregatedStatus(sessionId)` — Get status including all descendants
- `getDescendants(sessionId)` — Get all children recursively
- `sortedRoots()` — Get root sessions sorted by aggregated urgency

### Hook Integration

Added `SubagentStop` hook (`scripts/subagent-stop.sh`) that:
- Captures subagent completion
- Links subagent to parent via `parent_session_id`
- Marks subagent as "completed" status

Added `subagent_start` and `subagent_stop` event types in server.

### UI Tree Navigation

| Key | Action |
|-----|--------|
| `←` | Collapse selected session |
| `→` | Expand selected session |
| `Enter` | Toggle expand/collapse (if has children) or open detail |
| `Space` | Always open detail view |

### Next Steps for Subagent Detection

Currently relies on SubagentStop hook which fires when subagent completes. To detect subagents at spawn time:

1. **PostToolUse with Task tool** — When `tool_name === 'Task'`, could extract subagent session_id from tool response
2. **Session naming patterns** — Claude Code may use predictable subagent IDs
3. **Transcript parsing** — Parse transcript files to find Task tool invocations

## Future Features

### VS Code Extension for Quick Actions

To send input to VS Code integrated terminals, we need a VS Code extension that:

1. Exposes an HTTP endpoint or socket
2. Receives commands like `{ terminalId: "xyz", text: "y" }`
3. Uses `vscode.window.terminals[i].sendText()` API

**Architecture sketch**:
```
Dashboard → HTTP POST → VS Code Extension → terminal.sendText()
```

The extension would need to:
- Track terminal IDs and map them to session IDs
- Listen on a port (or use IPC)
- Handle authentication (only accept localhost requests)

### iTerm2 AppleScript Integration

iTerm2 can be controlled via AppleScript:

```applescript
tell application "iTerm2"
  tell current session of current window
    write text "y"
  end tell
end tell
```

Or via its Python API. Need to:
1. Detect iTerm2 session ID in hook (`$ITERM_SESSION_ID`)
2. Use `osascript` to send text to specific session

### Sound/Visual Alerts

Could integrate with:
- `afplay` for macOS sounds
- `terminal-notifier` for notifications
- Existing `ambient-alerts` plugin (user already has this)

### Session History

The transcript files at `transcript_path` contain full conversation history. Could:
- Parse and display recent messages
- Show tool usage timeline
- Enable searching across sessions

## Design Decisions Log

### Why Bun?

- Built-in SQLite support (`bun:sqlite`)
- Fast startup time for CLI
- Native TypeScript support
- Used by claude-canvas (inspiration project)

### Why SQLite for persistence?

- Sessions need to survive dashboard restarts
- Simple file-based storage, no external database
- Bun has excellent SQLite integration
- Single file at `~/.claude-session-manager.db`

### Why hooks instead of process scanning?

- Hooks are reliable and official
- Get accurate session state (not guessing from process activity)
- Terminal context available in hook environment
- Works regardless of terminal type

### Why UserPromptSubmit hook?

- Catches sessions that were running before hooks were installed
- Every message registers the session — no manual restart needed
- Idempotent — safe to call multiple times

### Status vocabulary

Instead of technical terms:
- "idle" → "Chilling", "Lounging", "Daydreaming"
- "working" → "Cooking", "Scheming", "Tinkering"
- "needs_input" → "Waiting", "Your turn", "Paging you"

Each session gets a consistent verb (based on session ID hash) for variety without randomness.

### Emoji selection

Based on project name keywords:
- `bio`, `lab`, `health` → 🧬
- `grant`, `money`, `finance` → 💰
- `ai`, `ml`, `claude` → 🤖
- Default → rotating sea creatures (🦀, 🐙, 🦑, etc.)

## Testing Notes

### Manual Testing

```bash
# Start dashboard
bun run src/cli.ts

# Simulate session in another terminal
curl -X POST http://localhost:7432/event \
  -H "Content-Type: application/json" \
  -d '{"event":"session_start","session_id":"test-123","cwd":"/tmp/test-project"}'

# Simulate notification
curl -X POST http://localhost:7432/event \
  -H "Content-Type: application/json" \
  -d '{"event":"notification","session_id":"test-123","message":"Approve file write?"}'

# Check sessions
curl http://localhost:7432/sessions | jq .
```

### Automated Testing

No tests written yet. Would recommend:
- Unit tests for `store.ts` (SQLite operations)
- Integration tests for `server.ts` (HTTP endpoints)
- Component tests for Dashboard (with mocked store)

## Known Issues

1. **Session names show truncated IDs** — Happens when hooks don't send `cwd` or name derivation fails. Run `bun run src/cli.ts clear` and re-register sessions.

2. **Quick actions don't work in VS Code terminal** — Expected. Needs VS Code extension (see Future Features).

3. **Stale sessions accumulate** — Sessions that crashed or were killed without SessionEnd hook stay in database. Use `bun run src/cli.ts prune -m 60` to clean up.

## Contact

This project was created collaboratively with Claude Opus 4.5. The original conversation context may be summarized, but this handoff document captures all essential information for continuing development.
