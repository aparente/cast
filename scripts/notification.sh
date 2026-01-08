#!/bin/bash
# Hook: Notification
# Fires when Claude needs user permission or is waiting for input
# This is the key hook for alerting in the dashboard

CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
MESSAGE=$(echo "$INPUT" | jq -r '.message // "Waiting for input"')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"notification\",
    \"session_id\": \"$SESSION_ID\",
    \"cwd\": \"$CWD\",
    \"message\": $(echo "$MESSAGE" | jq -R .),
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > /dev/null 2>&1 || true

exit 0
