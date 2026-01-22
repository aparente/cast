#!/bin/bash
# Hook: Notification
# Fires when Claude needs user permission or is waiting for input

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
MESSAGE=$(echo "$INPUT" | jq -r '.message // "Waiting for input"')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Extract additional context for subagent detection
PARENT_SESSION_ID=$(echo "$INPUT" | jq -r '.parent_session_id // empty')
CONVERSATION_ID=$(echo "$INPUT" | jq -r '.conversation_id // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Skip plugin-spawned sessions (e.g., double-shot-latte judge instances)
if is_plugin_session "$CWD"; then
  debug_log "Skipping plugin session: cwd=$CWD"
  exit 0
fi

# Debug: Log the RAW payload to see all available fields
debug_log "=== NOTIFICATION HOOK RAW PAYLOAD ==="
debug_log "$(echo "$INPUT" | jq -c '.' 2>/dev/null || echo "$INPUT")"
debug_log "=== PARSED FIELDS ==="
debug_log "  session_id: $SESSION_ID"
debug_log "  parent_session_id: ${PARENT_SESSION_ID:-<none>}"
debug_log "  conversation_id: ${CONVERSATION_ID:-<none>}"
debug_log "  cwd: $CWD"
debug_log "  message: ${MESSAGE:0:80}"

# Check if this session is known to Cast
SESSION_EXISTS=$(curl -s "http://${CSM_HOST}:${CSM_PORT}/sessions/$SESSION_ID" 2>/dev/null | jq -r '.id // empty')
if [ -n "$SESSION_EXISTS" ]; then
  debug_log "  status: KNOWN session"
else
  debug_log "  status: UNKNOWN session (potential subagent)"
  # Try to find a likely parent session in the same project
  # This helps link orphan subagent notifications to their parent
  if [ -n "$CWD" ]; then
    LIKELY_PARENT=$(curl -s "http://${CSM_HOST}:${CSM_PORT}/sessions" 2>/dev/null | \
      jq -r --arg cwd "$CWD" '.[] | select(.projectPath == $cwd and .parentId == null) | .id' | head -1)
    if [ -n "$LIKELY_PARENT" ]; then
      debug_log "  likely_parent: $LIKELY_PARENT (same project path)"
      PARENT_SESSION_ID="$LIKELY_PARENT"
    fi
  fi
fi
debug_log "========================"

# Get last assistant message for context (what Claude said before waiting)
LAST_MESSAGE=$(get_last_assistant_message "$CWD" "$SESSION_ID")

# Build the event payload
# Include parent_session_id if we detected this is a subagent
if [ -n "$PARENT_SESSION_ID" ]; then
  send_event "{
    \"event\": \"notification\",
    \"session_id\": \"$SESSION_ID\",
    \"parent_session_id\": \"$PARENT_SESSION_ID\",
    \"cwd\": \"$CWD\",
    \"message\": $(echo "$MESSAGE" | jq -R .),
    \"last_message\": $(echo "$LAST_MESSAGE" | jq -R .),
    \"timestamp\": \"$(timestamp)\"
  }"
else
  send_event "{
    \"event\": \"notification\",
    \"session_id\": \"$SESSION_ID\",
    \"cwd\": \"$CWD\",
    \"message\": $(echo "$MESSAGE" | jq -R .),
    \"last_message\": $(echo "$LAST_MESSAGE" | jq -R .),
    \"timestamp\": \"$(timestamp)\"
  }"
fi

exit 0
