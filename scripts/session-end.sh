#!/bin/bash
# Hook: SessionEnd
# Unregisters a Claude Code session from the dashboard

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

send_event "{
  \"event\": \"session_end\",
  \"session_id\": \"$SESSION_ID\",
  \"timestamp\": \"$(timestamp)\"
}"

exit 0
