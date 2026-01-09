#!/bin/bash
# Hook: SessionStart
# Registers a new Claude Code session with the dashboard
# Captures terminal context for quick actions
# Derives descriptive project name from package.json or git remote

CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

# Read hook input from stdin
INPUT=$(cat)

# Extract fields using jq
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  echo "No session_id in hook input" >&2
  exit 0
fi

# Derive a descriptive project name
PROJECT_NAME=""

if [ -n "$CWD" ] && [ -d "$CWD" ]; then
  # Try package.json first (Node.js projects)
  if [ -f "$CWD/package.json" ]; then
    PROJECT_NAME=$(jq -r '.name // empty' "$CWD/package.json" 2>/dev/null)
  fi

  # Try pyproject.toml (Python projects)
  if [ -z "$PROJECT_NAME" ] && [ -f "$CWD/pyproject.toml" ]; then
    PROJECT_NAME=$(grep -m1 '^name\s*=' "$CWD/pyproject.toml" 2>/dev/null | sed 's/.*=\s*"\([^"]*\)".*/\1/')
  fi

  # Try git remote URL
  if [ -z "$PROJECT_NAME" ] && [ -d "$CWD/.git" ]; then
    GIT_URL=$(git -C "$CWD" remote get-url origin 2>/dev/null)
    if [ -n "$GIT_URL" ]; then
      # Extract repo name from URL (handles both HTTPS and SSH)
      PROJECT_NAME=$(echo "$GIT_URL" | sed 's/.*[/:]\([^/]*\)\.git$/\1/' | sed 's/.*[/:]\([^/]*\)$/\1/')
    fi
  fi

  # Fall back to directory name
  if [ -z "$PROJECT_NAME" ]; then
    PROJECT_NAME=$(basename "$CWD")
  fi
fi

# Detect terminal context for quick actions
TERMINAL_TYPE="unknown"
TERMINAL_ID=""

# Check for tmux
if [ -n "$TMUX" ] && [ -n "$TMUX_PANE" ]; then
  TERMINAL_TYPE="tmux"
  # Get full pane target (session:window.pane)
  TERMINAL_ID=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || echo "$TMUX_PANE")
fi

# Check for VS Code integrated terminal
if [ -n "$VSCODE_INJECTION" ] || [ -n "$TERM_PROGRAM" ] && [ "$TERM_PROGRAM" = "vscode" ]; then
  TERMINAL_TYPE="vscode"
  # VS Code terminal ID would need extension to fully resolve
  TERMINAL_ID="${VSCODE_SHELL_INTEGRATION:-unknown}"
fi

# Check for iTerm2
if [ "$TERM_PROGRAM" = "iTerm.app" ]; then
  TERMINAL_TYPE="iterm2"
  TERMINAL_ID="${ITERM_SESSION_ID:-unknown}"
fi

# Capture PID for potential stdin injection
SHELL_PID=$$
TTY_PATH=$(tty 2>/dev/null || echo "unknown")

# POST to dashboard server
curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"session_start\",
    \"session_id\": \"$SESSION_ID\",
    \"cwd\": \"$CWD\",
    \"project_name\": \"$PROJECT_NAME\",
    \"terminal_type\": \"$TERMINAL_TYPE\",
    \"terminal_id\": \"$TERMINAL_ID\",
    \"shell_pid\": $SHELL_PID,
    \"tty_path\": \"$TTY_PATH\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > /dev/null 2>&1 || true

exit 0
