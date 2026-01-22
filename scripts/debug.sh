#!/bin/bash
# Debug helper for Cast - enables logging and tails the log file
# Hooks run in separate processes, so we use a file marker (~/.cast-debug)

case "${1:-help}" in
  on)
    touch "$HOME/.cast-debug"
    echo "✓ Debug mode enabled (created ~/.cast-debug)"
    echo "  Hooks will now log to /tmp/cast-debug.log"
    echo "  Run: tail -f /tmp/cast-debug.log"
    ;;
  off)
    rm -f "$HOME/.cast-debug"
    echo "✓ Debug mode disabled (removed ~/.cast-debug)"
    ;;
  tail)
    echo "Tailing Cast debug log (Ctrl+C to stop)..."
    tail -f /tmp/cast-debug.log 2>/dev/null || echo "No log file yet. Enable debug mode first."
    ;;
  clear)
    rm -f /tmp/cast-debug.log
    echo "✓ Debug log cleared"
    ;;
  status)
    echo "Debug marker: $([ -f "$HOME/.cast-debug" ] && echo "ENABLED (~/.cast-debug exists)" || echo "disabled")"
    if [ -f /tmp/cast-debug.log ]; then
      echo "Debug log: $(wc -l < /tmp/cast-debug.log) lines"
      echo ""
      echo "Last 10 entries:"
      tail -10 /tmp/cast-debug.log
    else
      echo "Debug log: not found (no hooks have logged yet)"
    fi
    ;;
  help|*)
    echo "Cast Debug Helper"
    echo ""
    echo "Usage: ./scripts/debug.sh <command>"
    echo ""
    echo "Commands:"
    echo "  on      Enable debug mode (creates ~/.cast-debug marker file)"
    echo "  off     Disable debug mode (removes marker file)"
    echo "  tail    Follow the debug log in real-time"
    echo "  clear   Clear the debug log"
    echo "  status  Show debug state and last log entries"
    echo ""
    echo "Note: Hooks run in separate processes spawned by Claude Code,"
    echo "so we use a file marker instead of environment variables."
    ;;
esac
