#!/bin/bash
# Hook: Stop
# Fires when Claude's turn is about to end
# Parses transcript to extract what Claude said/did for status display

CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Try to extract last assistant message from transcript for status
LAST_MESSAGE=""
if [ -n "$CWD" ]; then
  # Convert CWD to Claude's project path format (slashes become dashes)
  PROJECT_DIR=$(echo "$CWD" | sed 's|^/||' | sed 's|/|-|g')
  TRANSCRIPT_PATH="$HOME/.claude/projects/-$PROJECT_DIR/$SESSION_ID.jsonl"

  if [ -f "$TRANSCRIPT_PATH" ]; then
    # Get last assistant message text (first text block, first 100 chars)
    LAST_MESSAGE=$(grep '"type":"assistant"' "$TRANSCRIPT_PATH" 2>/dev/null | \
      tail -1 | \
      jq -r '.message.content[] | select(.type=="text") | .text' 2>/dev/null | \
      head -1 | \
      head -c 100 | \
      tr '\n' ' ' | \
      sed 's/^[[:space:]]*//' | \
      sed 's/[[:space:]]*$//')

    # Truncate at sentence boundary if possible
    if [ ${#LAST_MESSAGE} -gt 50 ]; then
      TRUNCATED=$(echo "$LAST_MESSAGE" | sed 's/\([.!?]\).*/\1/')
      if [ ${#TRUNCATED} -gt 10 ] && [ ${#TRUNCATED} -lt 80 ]; then
        LAST_MESSAGE="$TRUNCATED"
      else
        LAST_MESSAGE="${LAST_MESSAGE:0:50}..."
      fi
    fi
  fi
fi

# Send status update with parsed message
curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"status_change\",
    \"session_id\": \"$SESSION_ID\",
    \"cwd\": \"$CWD\",
    \"status\": \"idle\",
    \"last_message\": $(echo "$LAST_MESSAGE" | jq -R .),
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > /dev/null 2>&1 || true

exit 0
