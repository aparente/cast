#!/bin/bash
# Hook: UserPromptSubmit
# Fires every time user sends a message - ensures session is registered
# This catches sessions that were running before the dashboard started
# Also extracts project name for better session identification

CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
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
      PROJECT_NAME=$(echo "$GIT_URL" | sed 's/.*[/:]\([^/]*\)\.git$/\1/' | sed 's/.*[/:]\([^/]*\)$/\1/')
    fi
  fi

  # Fall back to directory name
  if [ -z "$PROJECT_NAME" ]; then
    PROJECT_NAME=$(basename "$CWD")
  fi
fi

# Detect terminal context
# Priority: tmux > iterm2 > vscode (tmux can run inside others)
TERMINAL_TYPE="unknown"
TERMINAL_ID=""

# Check for tmux FIRST (highest priority - enables quick actions)
if [ -n "$TMUX" ] && [ -n "$TMUX_PANE" ]; then
  TERMINAL_TYPE="tmux"
  TERMINAL_ID=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || echo "$TMUX_PANE")
# Check for iTerm2
elif [ "$TERM_PROGRAM" = "iTerm.app" ]; then
  TERMINAL_TYPE="iterm2"
  TERMINAL_ID="${ITERM_SESSION_ID:-unknown}"
# Check for VS Code integrated terminal (lowest priority)
elif [ "$TERM_PROGRAM" = "vscode" ] || [ -n "$VSCODE_INJECTION" ]; then
  TERMINAL_TYPE="vscode"
fi

# Register/update session with project name
curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"session_start\",
    \"session_id\": \"$SESSION_ID\",
    \"cwd\": \"$CWD\",
    \"project_name\": \"$PROJECT_NAME\",
    \"terminal_type\": \"$TERMINAL_TYPE\",
    \"terminal_id\": \"$TERMINAL_ID\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > /dev/null 2>&1 || true

# Set status to working - Claude is about to process user's message
curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"status_change\",
    \"session_id\": \"$SESSION_ID\",
    \"cwd\": \"$CWD\",
    \"status\": \"working\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > /dev/null 2>&1 || true

exit 0
