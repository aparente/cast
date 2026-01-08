#!/bin/bash
# Hook: SessionEnd
# Unregisters a Claude Code session from the dashboard

CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"session_end\",
    \"session_id\": \"$SESSION_ID\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > /dev/null 2>&1 || true

exit 0
