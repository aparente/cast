#!/bin/bash
# Shared utilities for Cast hook scripts

# Server configuration with defaults
CSM_PORT="${CSM_PORT:-7432}"
CSM_HOST="${CSM_HOST:-localhost}"

# Derive a descriptive project name from the working directory
# Usage: derive_project_name "/path/to/project"
derive_project_name() {
  local cwd="$1"
  local project_name=""

  if [ -z "$cwd" ] || [ ! -d "$cwd" ]; then
    echo ""
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
