# Claude Session Manager 🦀

A terminal UI (TUI) for managing multiple Claude Code sessions. See which sessions need attention at a glance, with playful design touches that make managing AI assistants feel like play.

## Features

- **Real-time session tracking** — All active Claude Code sessions in one dashboard
- **Smart session names** — Auto-detects project name from package.json, git remote, or directory
- **Progress tracking** — Shows task progress (X/Y completed) from Claude's TodoWrite tool
- **Status descriptions** — See what Claude is currently doing via transcript parsing
- **Subagent tree view** — See Task subagents as children of parent sessions with expandable rows
- **Status bubbling** — If any subagent needs input, parent session shows alert indicator
- **Alert highlighting** — Sessions needing input bubble to the top with ⚡ indicators
- **List & Kanban views** — Toggle between views with `l` and `k` keys
- **Quick actions** — Approve/deny/respond directly from dashboard (tmux sessions)
- **SQLite persistence** — Sessions survive dashboard restarts
- **Playful design** — Status verbs like "Cooking", "Scheming", "Paging you" + contextual emojis

## Quick Start

```bash
# Install dependencies
bun install

# Start the dashboard
bun run src/cli.ts

# That's it! Sessions auto-register when you send messages.
```

## Installation

### 1. Clone and install

```bash
git clone https://github.com/yourusername/claude-session-manager.git
cd claude-session-manager
bun install
```

### 2. Install Claude Code hooks

The hooks are what allow the dashboard to "see" your Claude Code sessions.

**Option A**: Run the installer (recommended)
```bash
bun run src/cli.ts install-hooks
# Copy the JSON output to ~/.claude/settings.json
```

**Option B**: Manual installation - add to `~/.claude/settings.json`:
```json
{
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "command", "command": "/path/to/scripts/session-start.sh", "timeout": 5}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "/path/to/scripts/session-end.sh", "timeout": 5}]}],
    "Notification": [{"hooks": [{"type": "command", "command": "/path/to/scripts/notification.sh", "timeout": 5}]}],
    "PostToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "/path/to/scripts/tool-use.sh", "timeout": 5}]}],
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "/path/to/scripts/user-prompt.sh", "timeout": 5}]}]
  }
}
```

### 3. Use your Claude Code sessions

Sessions automatically register when:
- A new session starts (SessionStart hook)
- You send a message (UserPromptSubmit hook)
- Claude uses any tool (PostToolUse hook)

No need to restart existing sessions - just send a message in each one.

## Usage

### CLI Commands

```bash
# Launch the interactive dashboard (default)
bun run src/cli.ts

# Run server only (headless mode)
bun run src/cli.ts server

# List sessions from command line
bun run src/cli.ts list

# Clear all sessions from database
bun run src/cli.ts clear

# Remove sessions older than N minutes
bun run src/cli.ts prune -m 60

# Show hook installation instructions
bun run src/cli.ts install-hooks
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate sessions |
| `←` / `→` | Collapse/expand subagent tree |
| `Enter` | Toggle expand (if has children) or open detail |
| `Space` | Open detail view |
| `l` | Switch to list view |
| `k` | Switch to kanban view |
| `r` | Refresh |
| `q` | Quit |

### Quick Actions (in detail view)

| Key | Action |
|-----|--------|
| `y` | Approve (sends "y") |
| `n` | Deny (sends "n") |
| `r` | Type custom response |
| `Esc` | Back to list |

**Note**: Quick actions currently only work with **tmux** sessions. VS Code terminal and iTerm2 support is planned.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Claude Code Sessions                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Session 1    │  │ Session 2    │  │ Session N    │              │
│  │ (project-a)  │  │ (project-b)  │  │ (project-n)  │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
│         └────────────────┼─────────────────┘                       │
│                          │                                          │
│                    Hook Scripts                                     │
│         SessionStart, SessionEnd, Notification,                     │
│         PostToolUse, UserPromptSubmit                               │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP POST /event
                           ▼
              ┌────────────────────────┐
              │   Dashboard Server     │
              │   localhost:7432       │
              │                        │
              │  ┌──────────────────┐  │
              │  │ SQLite Store     │  │
              │  │ ~/.claude-       │  │
              │  │ session-manager  │  │
              │  │ .db              │  │
              │  └──────────────────┘  │
              │                        │
              │  Endpoints:            │
              │  POST /event           │
              │  POST /action          │
              │  GET  /sessions        │
              │  GET  /health          │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │   Terminal UI (Ink)    │
              │                        │
              │  ┌──────────────────┐  │
              │  │ List View        │  │
              │  │ Kanban View      │  │
              │  │ Detail View      │  │
              │  └──────────────────┘  │
              └────────────────────────┘
```

### Hook Events

| Hook | When it fires | What it does |
|------|--------------|--------------|
| `SessionStart` | New session begins | Registers session with terminal context |
| `SessionEnd` | Session terminates | Removes session from dashboard |
| `Notification` | Claude needs input | Sets alerting=true, status=needs_input |
| `PostToolUse` | After any tool call | Updates status=working, tracks TodoWrite |
| `UserPromptSubmit` | User sends message | Ensures session is registered |
| `Stop` | Claude's turn ends | Parses transcript for status description |

### Data Flow

1. **Hook fires** → Shell script reads JSON from stdin
2. **Script extracts** session_id, cwd, terminal context
3. **Script POSTs** to dashboard server at localhost:7432
4. **Server updates** SQLite database + in-memory cache
5. **Store notifies** React components via pub/sub
6. **UI re-renders** with new session state

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CSM_PORT` | `7432` | Server port |
| `CSM_HOST` | `localhost` | Server host |

### Files

| Path | Purpose |
|------|---------|
| `~/.claude-session-manager.db` | SQLite database for session persistence |
| `~/.claude/settings.json` | Claude Code hooks configuration |

## Terminal Support for Quick Actions

Quick actions (approve/deny/respond from dashboard) require the ability to send input to the terminal running Claude Code.

| Terminal | Status | How it works |
|----------|--------|--------------|
| **tmux** | ✅ Supported | `tmux send-keys -t <pane>` |
| **VS Code** | 🔜 Planned | Needs VS Code extension |
| **iTerm2** | 🔜 Planned | AppleScript integration |
| **Other** | ❌ View only | No way to send input |

The dashboard detects terminal type via environment variables:
- `$TMUX` / `$TMUX_PANE` for tmux
- `$TERM_PROGRAM=vscode` for VS Code
- `$TERM_PROGRAM=iTerm.app` for iTerm2

## Tech Stack

- **[Bun](https://bun.sh)** — Fast JavaScript runtime with built-in SQLite
- **[Ink](https://github.com/vadimdemedes/ink)** — React for terminal UIs
- **[Commander.js](https://github.com/tj/commander.js)** — CLI framework
- **[Claude Code Hooks](https://docs.anthropic.com/claude-code/hooks)** — Event system

## Design Philosophy

Inspired by the "design delight" of Claude Code itself:
- **Playful status verbs** — "Cooking", "Scheming", "Tinkering" instead of "working"
- **Contextual emojis** — 🧬 for bio projects, 💰 for finance, 🤖 for AI
- **Animated elements** — Spinner for working sessions, walking crab for empty state
- **Human-friendly messages** — "Someone needs you!" instead of "1 session alerting"

## Future Plans

- [x] Subagent tree view (Tasks as children of parent sessions)
- [x] TodoWrite progress tracking
- [x] Smart session naming (package.json, git, directory)
- [x] Transcript parsing for status descriptions
- [x] Quick actions for tmux sessions
- [ ] VS Code extension for quick actions
- [ ] iTerm2 AppleScript integration
- [ ] Sound/visual alerts integration
- [ ] Improved quick action UX (visible input field)

## License

MIT
