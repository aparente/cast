#!/bin/bash
# Shared utilities for Cast hook scripts

# Server configuration with defaults
CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

# Check if a path is a "global" location (not a specific project)
# Returns 0 (true) if global, 1 (false) if project-specific
is_global_path() {
  local path="$1"
  local home_dir="$HOME"

  # Paths inside ~/.claude are global (working on Claude config/skills/hooks)
  if [[ "$path" == "$home_dir/.claude"* ]]; then
    return 0
  fi

  # Home directory itself is global
  if [ "$path" = "$home_dir" ]; then
    return 0
  fi

  # Common generic directories
  case "$path" in
    "$home_dir/Desktop"|"$home_dir/Downloads"|"$home_dir/Documents"|"/tmp"*|"/var/tmp"*)
      return 0
      ;;
  esac

  return 1
}

# Generate a friendly random name for global sessions
generate_friendly_name() {
  # Adjectives and nouns for friendly names
  local adjectives=("quick" "bright" "calm" "bold" "swift" "keen" "warm" "cool" "fresh" "clear")
  local nouns=("spark" "wave" "leaf" "star" "cloud" "breeze" "stone" "flame" "river" "moon")

  # Use /dev/urandom for randomness (trim whitespace from od output)
  local rand1 rand2
  rand1=$(od -An -N1 -tu1 /dev/urandom | tr -d ' ')
  rand2=$(od -An -N1 -tu1 /dev/urandom | tr -d ' ')
  local adj_idx=$(( rand1 % 10 ))
  local noun_idx=$(( rand2 % 10 ))

  echo "${adjectives[$adj_idx]}-${nouns[$noun_idx]}"
}

# Derive a descriptive project name from the working directory
# Usage: derive_project_name "/path/to/project"
derive_project_name() {
  local cwd="$1"
  local project_name=""

  if [ -z "$cwd" ] || [ ! -d "$cwd" ]; then
    echo ""
    return
  fi

  # Check if this is a global/generic path (not a specific project)
  if is_global_path "$cwd"; then
    # For ~/.claude paths, indicate what kind of Claude work
    if [[ "$cwd" == "$HOME/.claude"* ]]; then
      local subpath="${cwd#$HOME/.claude}"
      case "$subpath" in
        /plugins*|/skills*) echo "skill-editing" ;;
        /hooks*) echo "hook-config" ;;
        /plans*) echo "plan-editing" ;;
        /handoffs*) echo "handoff-review" ;;
        *) echo "claude-config" ;;
      esac
    else
      # Generic location - use friendly random name
      generate_friendly_name
    fi
    return
  fi

  # Try package.json first (Node.js projects)
  if [ -f "$cwd/package.json" ]; then
    project_name=$(jq -r '.name // empty' "$cwd/package.json" 2>/dev/null)
  fi

  # Try pyproject.toml (Python projects)
  if [ -z "$project_name" ] && [ -f "$cwd/pyproject.toml" ]; then
    project_name=$(grep -m1 '^name\s*=' "$cwd/pyproject.toml" 2>/dev/null | sed 's/.*=\s*"\([^"]*\)".*/\1/')
  fi

  # Try git remote URL
  if [ -z "$project_name" ] && [ -d "$cwd/.git" ]; then
    local git_url
    git_url=$(git -C "$cwd" remote get-url origin 2>/dev/null)
    if [ -n "$git_url" ]; then
      project_name=$(echo "$git_url" | sed 's/.*[/:]\([^/]*\)\.git$/\1/' | sed 's/.*[/:]\([^/]*\)$/\1/')
    fi
  fi

  # Fall back to directory name
  if [ -z "$project_name" ]; then
    project_name=$(basename "$cwd")
  fi

  echo "$project_name"
}

# Detect terminal type and ID for quick actions
# Sets: TERMINAL_TYPE, TERMINAL_ID
# Priority: tmux > iterm2 > vscode (tmux can run inside others)
detect_terminal() {
  TERMINAL_TYPE="unknown"
  TERMINAL_ID=""

  # Check for tmux FIRST (highest priority - enables quick actions)
  if [ -n "$TMUX" ] && [ -n "$TMUX_PANE" ]; then
    TERMINAL_TYPE="tmux"
    TERMINAL_ID=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || echo "$TMUX_PANE")
  # Check for iTerm2
  elif [ "$TERM_PROGRAM" = "iTerm.app" ]; then
    TERMINAL_TYPE="iterm2"
    TERMINAL_ID="${ITERM_SESSION_ID:-unknown}"
  # Check for VS Code integrated terminal (lowest priority)
  elif [ "$TERM_PROGRAM" = "vscode" ] || [ -n "$VSCODE_INJECTION" ]; then
    TERMINAL_TYPE="vscode"
    TERMINAL_ID="${VSCODE_SHELL_INTEGRATION:-}"
  fi
}

# Send an event to the Cast server
# Usage: send_event '{"event": "...", ...}'
send_event() {
  local payload="$1"
  curl -s -X POST "http://${CSM_HOST}:${CSM_PORT}/event" \
    -H "Content-Type: application/json" \
    -d "$payload" > /dev/null 2>&1 || true
}

# Get current timestamp in ISO format
timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

# Extract last assistant message from transcript for context display
# Usage: get_last_assistant_message "/path/to/project" "session_id"
# Returns: First ~100 chars of last assistant message text
get_last_assistant_message() {
  local cwd="$1"
  local session_id="$2"

  if [ -z "$cwd" ] || [ -z "$session_id" ]; then
    echo ""
    return
  fi

  # Convert CWD to Claude's project path format (slashes become dashes)
  local project_dir
  project_dir=$(echo "$cwd" | sed 's|^/||' | sed 's|/|-|g')
  local transcript_path="$HOME/.claude/projects/-$project_dir/$session_id.jsonl"

  if [ ! -f "$transcript_path" ]; then
    echo ""
    return
  fi

  # Get last assistant message text (first text block, first 100 chars)
  local last_msg
  last_msg=$(grep '"type":"assistant"' "$transcript_path" 2>/dev/null | \
    tail -1 | \
    jq -r '.message.content[] | select(.type=="text") | .text' 2>/dev/null | \
    head -1 | \
    head -c 100 | \
    tr '\n' ' ' | \
    sed 's/^[[:space:]]*//' | \
    sed 's/[[:space:]]*$//')

  # Truncate at sentence boundary if possible
  if [ ${#last_msg} -gt 50 ]; then
    local truncated
    truncated=$(echo "$last_msg" | sed 's/\([.!?]\).*/\1/')
    if [ ${#truncated} -gt 10 ] && [ ${#truncated} -lt 80 ]; then
      last_msg="$truncated"
    else
      last_msg="${last_msg:0:50}..."
    fi
  fi

  echo "$last_msg"
}

# Find the most recent plan file for a project
# Usage: find_recent_plan "/path/to/project"
# Returns: path to most recent .md file in ~/.claude/projects/<encoded-path>/ or empty
find_recent_plan() {
  local cwd="$1"
  if [ -z "$cwd" ]; then
    echo ""
    return
  fi

  # Claude Code encodes project paths by replacing / with -
  local encoded_path="${cwd//\//-}"
  encoded_path="${encoded_path#-}"  # Remove leading dash

  local claude_project_dir="$HOME/.claude/projects/$encoded_path"

  if [ ! -d "$claude_project_dir" ]; then
    echo ""
    return
  fi

  # Find the most recently modified .md file (plan files are markdown)
  # Exclude conversation transcripts (.jsonl files)
  local plan_file
  plan_file=$(find "$claude_project_dir" -name "*.md" -type f -mmin -60 2>/dev/null | \
    xargs ls -t 2>/dev/null | head -1)

  echo "$plan_file"
}

# Extract plan steps from a markdown plan file
# Usage: extract_plan_steps "/path/to/plan.md"
# Returns: JSON array of {title, completed} objects
extract_plan_steps() {
  local plan_file="$1"
  if [ -z "$plan_file" ] || [ ! -f "$plan_file" ]; then
    echo "[]"
    return
  fi

  # Extract markdown list items (- [ ] or - [x] for checkboxes, or just - for bullet points)
  # Also capture ## headings as major steps
  local steps="[]"

  # Parse checkboxes (- [ ] unchecked, - [x] checked)
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*\[([[:space:]]|x|X)\][[:space:]]*(.+)$ ]]; then
      local check="${BASH_REMATCH[1]}"
      local title="${BASH_REMATCH[2]}"
      local completed="false"
      if [[ "$check" =~ ^[xX]$ ]]; then
        completed="true"
      fi
      # Escape quotes in title for JSON
      title="${title//\"/\\\"}"
      steps=$(echo "$steps" | jq --arg t "$title" --argjson c "$completed" '. + [{title: $t, completed: $c}]')
    fi
  done < "$plan_file"

  # If no checkboxes found, try to extract numbered steps (1. 2. 3.)
  if [ "$steps" = "[]" ]; then
    while IFS= read -r line; do
      if [[ "$line" =~ ^[[:space:]]*[0-9]+\.[[:space:]]+(.+)$ ]]; then
        local title="${BASH_REMATCH[1]}"
        title="${title//\"/\\\"}"
        steps=$(echo "$steps" | jq --arg t "$title" '. + [{title: $t, completed: false}]')
      fi
    done < "$plan_file"
  fi

  echo "$steps"
}
