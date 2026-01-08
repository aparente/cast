#!/bin/bash
# Hook: PostToolUse
# Fires after Claude uses a tool - indicates active work
# Clears the alerting state since Claude is now working
# Special handling for Task tool to register subagents

CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Check if this is a Task tool (subagent spawn)
if [ "$TOOL_NAME" = "Task" ]; then
  # Extract task description from tool_input
  DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // .tool_input.prompt // empty' | head -c 50)
  SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // "Task"')

  # Generate a unique subagent ID based on timestamp
  SUBAGENT_ID="${SESSION_ID}-sub-$(date +%s)"

  if [ -n "$DESCRIPTION" ]; then
    # Register the subagent with descriptive name
    curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
      -H "Content-Type: application/json" \
      -d "{
        \"event\": \"subagent_start\",
        \"session_id\": \"$SUBAGENT_ID\",
        \"parent_session_id\": \"$SESSION_ID\",
        \"cwd\": \"$CWD\",
        \"subagent_type\": \"$SUBAGENT_TYPE\",
        \"description\": \"$DESCRIPTION\"
      }" > /dev/null 2>&1 || true
  fi
fi

# Always send tool_use event to update parent status
curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"tool_use\",
    \"session_id\": \"$SESSION_ID\",
    \"cwd\": \"$CWD\",
    \"tool_name\": \"$TOOL_NAME\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > /dev/null 2>&1 || true

exit 0
