#!/bin/bash
# Hook: SubagentStop
# Fires when a subagent (Task) completes its work

CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
SUBAGENT_ID=$(echo "$INPUT" | jq -r '.subagent_session_id // empty')
SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.subagent_type // empty')

if [ -z "$SESSION_ID" ] || [ -z "$SUBAGENT_ID" ]; then
  exit 0
fi

# Mark the subagent as completed
curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"subagent_stop\",
    \"session_id\": \"$SUBAGENT_ID\",
    \"parent_session_id\": \"$SESSION_ID\",
    \"subagent_type\": \"$SUBAGENT_TYPE\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > /dev/null 2>&1 || true

exit 0
