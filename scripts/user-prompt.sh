#!/bin/bash
# Hook: UserPromptSubmit
# Fires every time user sends a message - ensures session is registered
# This catches sessions that were running before the dashboard started

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

PROJECT_NAME=$(derive_project_name "$CWD")
detect_terminal

# Register/update session with project name
send_event "{
  \"event\": \"session_start\",
  \"session_id\": \"$SESSION_ID\",
  \"cwd\": \"$CWD\",
  \"project_name\": \"$PROJECT_NAME\",
  \"terminal_type\": \"$TERMINAL_TYPE\",
  \"terminal_id\": \"$TERMINAL_ID\",
  \"timestamp\": \"$(timestamp)\"
}"

# Set status to working - Claude is about to process user's message
send_event "{
  \"event\": \"status_change\",
  \"session_id\": \"$SESSION_ID\",
  \"cwd\": \"$CWD\",
  \"status\": \"working\",
  \"timestamp\": \"$(timestamp)\"
}"

exit 0
