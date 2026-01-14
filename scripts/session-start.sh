#!/bin/bash
# Hook: SessionStart
# Registers a new Claude Code session with the dashboard
# Captures terminal context for quick actions

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  echo "No session_id in hook input" >&2
  exit 0
fi

PROJECT_NAME=$(derive_project_name "$CWD")
detect_terminal

# Use PPID (parent process) to get the actual shell running Claude Code
# $$ is this script's PID which exits immediately
SHELL_PID=${PPID:-$$}
TTY_PATH=$(tty 2>/dev/null || echo "unknown")

send_event "{
  \"event\": \"session_start\",
  \"session_id\": \"$SESSION_ID\",
  \"cwd\": \"$CWD\",
  \"project_name\": \"$PROJECT_NAME\",
  \"terminal_type\": \"$TERMINAL_TYPE\",
  \"terminal_id\": \"$TERMINAL_ID\",
  \"shell_pid\": $SHELL_PID,
  \"tty_path\": \"$TTY_PATH\",
  \"timestamp\": \"$(timestamp)\"
}"

exit 0
