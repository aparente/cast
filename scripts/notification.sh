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

send_event "{
  \"event\": \"notification\",
  \"session_id\": \"$SESSION_ID\",
  \"cwd\": \"$CWD\",
  \"message\": $(echo "$MESSAGE" | jq -R .),
  \"timestamp\": \"$(timestamp)\"
}"

exit 0
