#!/bin/bash
# Hook: Stop
# Fires when Claude's turn is about to end
# Sets status to "idle" to indicate waiting for user input

CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Set status to idle - Claude's turn is ending
curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"status_change\",
    \"session_id\": \"$SESSION_ID\",
    \"cwd\": \"$CWD\",
    \"status\": \"idle\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > /dev/null 2>&1 || true

exit 0
