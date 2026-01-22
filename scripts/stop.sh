#!/bin/bash
# Hook: Stop
# Fires when Claude's turn is about to end
# Parses transcript to extract what Claude said/did for status display

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Skip plugin-spawned sessions (e.g., double-shot-latte judge instances)
if is_plugin_session "$CWD"; then
  exit 0
fi

# Get last assistant message for context display
LAST_MESSAGE=$(get_last_assistant_message "$CWD" "$SESSION_ID")

# Send idle status with last_message
# Server will ignore idle if status is already needs_input (notification fired first)
send_event "{
  \"event\": \"status_change\",
  \"session_id\": \"$SESSION_ID\",
  \"cwd\": \"$CWD\",
  \"status\": \"idle\",
  \"last_message\": $(echo "$LAST_MESSAGE" | jq -R .),
  \"timestamp\": \"$(timestamp)\"
}"

exit 0
