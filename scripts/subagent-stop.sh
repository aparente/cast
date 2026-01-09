#!/bin/bash
# Hook: SubagentStop
# Fires when a subagent (Task) completes its work

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
SUBAGENT_ID=$(echo "$INPUT" | jq -r '.subagent_session_id // empty')
SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.subagent_type // empty')

if [ -z "$SESSION_ID" ] || [ -z "$SUBAGENT_ID" ]; then
  exit 0
fi

send_event "{
  \"event\": \"subagent_stop\",
  \"session_id\": \"$SUBAGENT_ID\",
  \"parent_session_id\": \"$SESSION_ID\",
  \"subagent_type\": \"$SUBAGENT_TYPE\",
  \"timestamp\": \"$(timestamp)\"
}"

exit 0
