#!/bin/bash
# Hook: PostToolUse
# Fires after Claude uses a tool - indicates active work
# Special handling for Task tool (subagents), TodoWrite (task progress), and plan mode

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Handle TodoWrite tool (task progress tracking)
if [ "$TOOL_NAME" = "TodoWrite" ]; then
  TODOS=$(echo "$INPUT" | jq -c '.tool_input.todos // []')
  if [ -n "$TODOS" ] && [ "$TODOS" != "[]" ]; then
    send_event "{
      \"event\": \"todo_update\",
      \"session_id\": \"$SESSION_ID\",
      \"cwd\": \"$CWD\",
      \"todos\": $TODOS
    }"
  fi
fi

# Handle Task tool (subagent spawn)
if [ "$TOOL_NAME" = "Task" ]; then
  DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // .tool_input.prompt // empty' | head -c 50)
  SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // "Task"')
  SUBAGENT_ID="${SESSION_ID}-sub-$(date +%s)"

  if [ -n "$DESCRIPTION" ]; then
    send_event "{
      \"event\": \"subagent_start\",
      \"session_id\": \"$SUBAGENT_ID\",
      \"parent_session_id\": \"$SESSION_ID\",
      \"cwd\": \"$CWD\",
      \"subagent_type\": \"$SUBAGENT_TYPE\",
      \"description\": \"$DESCRIPTION\"
    }"
  fi
fi

# Handle EnterPlanMode tool (entering plan mode)
if [ "$TOOL_NAME" = "EnterPlanMode" ]; then
  send_event "{
    \"event\": \"plan_update\",
    \"session_id\": \"$SESSION_ID\",
    \"cwd\": \"$CWD\",
    \"plan_name\": \"Planning...\"
  }"
fi

# Handle ExitPlanMode tool (plan complete, try to find plan file)
if [ "$TOOL_NAME" = "ExitPlanMode" ]; then
  # Try to find the most recent plan file for this project
  PLAN_FILE=$(find_recent_plan "$CWD")
  if [ -n "$PLAN_FILE" ] && [ -f "$PLAN_FILE" ]; then
    PLAN_NAME=$(basename "$PLAN_FILE" .md | tr '_-' ' ')
    PLAN_STEPS=$(extract_plan_steps "$PLAN_FILE")
    send_event "{
      \"event\": \"plan_update\",
      \"session_id\": \"$SESSION_ID\",
      \"cwd\": \"$CWD\",
      \"plan_name\": \"$PLAN_NAME\",
      \"plan_file_path\": \"$PLAN_FILE\",
      \"plan_steps\": $PLAN_STEPS
    }"
  else
    # No plan file found, just mark as having exited plan mode
    send_event "{
      \"event\": \"plan_update\",
      \"session_id\": \"$SESSION_ID\",
      \"cwd\": \"$CWD\"
    }"
  fi
fi

# Always send tool_use event to update status
send_event "{
  \"event\": \"tool_use\",
  \"session_id\": \"$SESSION_ID\",
  \"cwd\": \"$CWD\",
  \"tool_name\": \"$TOOL_NAME\",
  \"timestamp\": \"$(timestamp)\"
}"

exit 0
