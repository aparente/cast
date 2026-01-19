#!/bin/bash
# Hook: Notification
# Fires when Claude needs user permission or is waiting for input

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
MESSAGE=$(echo "$INPUT" | jq -r '.message // "Waiting for input"')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Get last assistant message for context (what Claude said before waiting)
LAST_MESSAGE=$(get_last_assistant_message "$CWD" "$SESSION_ID")

send_event "{
  \"event\": \"notification\",
  \"session_id\": \"$SESSION_ID\",
  \"cwd\": \"$CWD\",
  \"message\": $(echo "$MESSAGE" | jq -R .),
  \"last_message\": $(echo "$LAST_MESSAGE" | jq -R .),
  \"timestamp\": \"$(timestamp)\"
}"

exit 0
