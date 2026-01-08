#!/bin/bash
# Hook: UserPromptSubmit
# Fires every time user sends a message - ensures session is registered
# This catches sessions that were running before the dashboard started

CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Detect terminal context
TERMINAL_TYPE="unknown"
TERMINAL_ID=""

if [ -n "$TMUX" ] && [ -n "$TMUX_PANE" ]; then
  TERMINAL_TYPE="tmux"
  TERMINAL_ID=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || echo "$TMUX_PANE")
fi

if [ "$TERM_PROGRAM" = "vscode" ] || [ -n "$VSCODE_INJECTION" ]; then
  TERMINAL_TYPE="vscode"
fi

if [ "$TERM_PROGRAM" = "iTerm.app" ]; then
  TERMINAL_TYPE="iterm2"
  TERMINAL_ID="${ITERM_SESSION_ID:-unknown}"
fi

# Register/update session (idempotent - just ensures it exists)
curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"session_start\",
    \"session_id\": \"$SESSION_ID\",
    \"cwd\": \"$CWD\",
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
