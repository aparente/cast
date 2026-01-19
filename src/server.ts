import { sessionStore } from './store.js';
import type { SessionStatus, TerminalType, QuickActionType, TodoItem, AttentionType, ClaudeSession, PlanContext, PlanStep } from './types.js';

/**
 * Keywords that indicate a critical input request (permission, approval, etc.)
 */
const CRITICAL_KEYWORDS = ['permission', 'approve', 'plan', 'proceed', 'allow', 'confirm', 'yes/no', 'y/n'];

/**
 * Determine if an input request is critical (permission) vs casual (question)
 */
function determineAttentionType(message?: string, isNotification?: boolean): AttentionType {
  if (!message && !isNotification) return null;

  // Notification events are at least casual - check for critical keywords
  if (isNotification) {
    const lowerMessage = (message || '').toLowerCase();
    const isCritical = CRITICAL_KEYWORDS.some(kw => lowerMessage.includes(kw));
    return isCritical ? 'critical' : 'casual';
  }

  return null;
}

const DEFAULT_PORT = 7432; // "SSMGR" on phone keypad :)

interface HookEvent {
  event: 'session_start' | 'session_end' | 'notification' | 'tool_use' | 'status_change' | 'subagent_start' | 'subagent_stop' | 'todo_update' | 'plan_update';
  session_id: string;
  cwd?: string;
  project_name?: string;       // Descriptive project name from package.json, git, etc.
  message?: string;
  tool_name?: string;
  status?: SessionStatus;
  last_message?: string;        // Last assistant message for status display
  timestamp?: string;
  // Terminal context fields
  terminal_type?: TerminalType;
  terminal_id?: string;
  shell_pid?: number;
  tty_path?: string;
  // Subagent hierarchy
  parent_session_id?: string;  // For subagents: the parent session ID
  subagent_type?: string;      // Type of subagent (e.g., "Explore", "Plan")
  description?: string;        // Task description for subagents
  // Todo tracking
  todos?: TodoItem[];          // Current todo list from TodoWrite
  // Plan tracking
  plan_name?: string;          // Name of the active plan
  plan_steps?: PlanStep[];     // Steps extracted from plan file
  plan_current_step?: number;  // Current step index (0-based)
  plan_file_path?: string;     // Path to the plan file
}

interface ActionRequest {
  session_id: string;
  action: QuickActionType;
  response?: string;  // For 'respond' action
}

/**
 * Derive a friendly session name from the working directory
 */
function deriveSessionName(cwd?: string): string {
  if (!cwd) return 'unknown';
  const parts = cwd.split('/');
  return parts[parts.length - 1] || 'root';
}

/**
 * Build a descriptive name for a subagent
 * Prioritizes description, falls back to type, then cwd
 */
function buildSubagentName(description?: string, subagentType?: string, cwd?: string): string {
  const baseName = deriveSessionName(cwd);
  const typeSuffix = subagentType ? ` (${subagentType})` : '';

  if (!description) {
    return subagentType ? `${baseName}${typeSuffix}` : baseName;
  }

  const truncatedDesc = description.length > 30
    ? description.slice(0, 27) + '...'
    : description;

  return truncatedDesc + typeSuffix;
}

/**
 * Send input to a tmux pane
 * Uses -l flag for literal text, then sends Enter separately
 * This approach works with Ink's raw mode input handling
 */
async function sendToTmux(paneTarget: string, text: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Send text with -l flag (literal - interprets text as-is)
    const textProc = Bun.spawn(['tmux', 'send-keys', '-t', paneTarget, '-l', text], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const textExit = await textProc.exited;
    if (textExit !== 0) {
      const stderr = await new Response(textProc.stderr).text();
      return { success: false, error: stderr || `Exit code ${textExit}` };
    }

    // Send Enter key separately to submit
    const enterProc = Bun.spawn(['tmux', 'send-keys', '-t', paneTarget, 'Enter'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const enterExit = await enterProc.exited;
    if (enterExit !== 0) {
      const stderr = await new Response(enterProc.stderr).text();
      return { success: false, error: stderr || `Exit code ${enterExit}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Focus/jump to a terminal session
 * For tmux: select-pane if in tmux, or use AppleScript to focus iTerm2
 * For others: best-effort app activation
 */
async function focusTerminal(session: ClaudeSession): Promise<{ success: boolean; error?: string }> {
  const { type, id } = session.terminal;

  if (type === 'tmux' && id) {
    try {
      // Check if we're inside tmux
      if (process.env.TMUX) {
        // First switch to the window, then select the pane
        // id format: "session:window.pane" (e.g., "main:0.1")
        const sessionWindow = id.split('.')[0] || id;

        // Switch to window first
        const winProc = Bun.spawn(['tmux', 'select-window', '-t', sessionWindow], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        await winProc.exited;

        // Then select the pane
        const paneProc = Bun.spawn(['tmux', 'select-pane', '-t', id], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const exit = await paneProc.exited;
        if (exit !== 0) {
          const stderr = await new Response(paneProc.stderr).text();
          return { success: false, error: stderr || `Exit code ${exit}` };
        }
        return { success: true };
      } else {
        // Not in tmux - use AppleScript to focus iTerm2 and switch to the tmux session
        // This works better than opening a new terminal
        const script = `
          tell application "iTerm2"
            activate
          end tell
        `;
        const proc = Bun.spawn(['osascript', '-e', script], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        await proc.exited;

        // After focusing iTerm, try to switch tmux to the right pane
        // (this works if iTerm is running tmux)
        const sessionWindow = id.split('.')[0] || id;
        const tmuxProc = Bun.spawn(['tmux', 'select-window', '-t', sessionWindow], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        await tmuxProc.exited;
        const paneProc = Bun.spawn(['tmux', 'select-pane', '-t', id], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        await paneProc.exited;

        return { success: true };
      }
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  if (type === 'iterm2') {
    try {
      const proc = Bun.spawn(['open', '-a', 'iTerm'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await proc.exited;
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  if (type === 'vscode') {
    try {
      // Detect if using Cursor (VS Code fork) or VS Code
      const appName = process.env.TERM_PROGRAM === 'cursor' ? 'Cursor' : 'Visual Studio Code';

      // Use AppleScript to activate VS Code and focus the terminal panel
      // This sends Ctrl+` which toggles/focuses the integrated terminal
      const script = `
        tell application "${appName}"
          activate
        end tell
        delay 0.2
        tell application "System Events"
          keystroke "\`" using control down
        end tell
      `;
      const proc = Bun.spawn(['osascript', '-e', script], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const exit = await proc.exited;
      if (exit !== 0) {
        // Fallback: just open the app if AppleScript fails
        const fallback = Bun.spawn(['open', '-a', appName], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        await fallback.exited;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  return { success: false, error: `Cannot focus terminal type: ${type}` };
}

/**
 * Handle incoming hook events
 */
function handleHookEvent(event: HookEvent): { success: boolean; message: string } {
  const { session_id, cwd } = event;

  switch (event.event) {
    case 'session_start': {
      // Use project_name from hook if available, otherwise derive from cwd
      const sessionName = event.project_name || deriveSessionName(cwd);
      sessionStore.upsert(session_id, {
        name: sessionName,
        projectPath: cwd,
        status: 'idle',
        alerting: false,
        terminal: {
          type: event.terminal_type || 'unknown',
          id: event.terminal_id || '',
          shellPid: event.shell_pid,
          ttyPath: event.tty_path,
        },
      });
      return { success: true, message: `Session ${session_id} registered as "${sessionName}"` };
    }

    case 'session_end': {
      sessionStore.remove(session_id);
      return { success: true, message: `Session ${session_id} removed` };
    }

    case 'notification': {
      const attentionType = determineAttentionType(event.message, true);
      const updates: Partial<ClaudeSession> = {
        status: 'needs_input',
        alerting: true,
        attentionType,
        currentTask: event.message || 'Waiting for input',
        pendingMessage: event.message,
      };
      // Include last assistant message for context display
      if (event.last_message) {
        updates.lastStatus = event.last_message;
      }
      sessionStore.upsert(session_id, updates);
      return { success: true, message: `Session ${session_id} alerting (${attentionType})` };
    }

    case 'tool_use': {
      sessionStore.upsert(session_id, {
        status: 'working',
        alerting: false,
        attentionType: null,  // Clear attention type when working
        currentTask: event.tool_name ? `Using ${event.tool_name}` : undefined,
        pendingMessage: undefined,  // Clear pending on tool use
      });
      return { success: true, message: `Session ${session_id} tool use recorded` };
    }

    case 'status_change': {
      const updates: Partial<ClaudeSession> = {};
      const currentSession = sessionStore.get(session_id);

      // Only update status if explicitly provided
      // BUT: Don't override needs_input with idle (race condition with Notification hook)
      if (event.status) {
        const shouldSkipIdle = event.status === 'idle' &&
          currentSession?.status === 'needs_input' &&
          currentSession?.alerting;

        if (!shouldSkipIdle) {
          updates.status = event.status;
          updates.alerting = event.status === 'needs_input';
          if (event.status !== 'needs_input') {
            updates.attentionType = null;
          }
        }
      }

      // Always update lastStatus if provided (for context display)
      if (event.last_message) {
        updates.lastStatus = event.last_message;
      }

      if (Object.keys(updates).length > 0) {
        sessionStore.upsert(session_id, updates);
      }
      return { success: true, message: `Session ${session_id} status updated` };
    }

    case 'subagent_start': {
      const name = buildSubagentName(event.description, event.subagent_type, cwd);
      sessionStore.upsert(session_id, {
        name,
        projectPath: cwd,
        status: 'working',
        alerting: false,
        parentId: event.parent_session_id,
        currentTask: event.description,
        terminal: {
          type: event.terminal_type || 'unknown',
          id: event.terminal_id || '',
          shellPid: event.shell_pid,
          ttyPath: event.tty_path,
        },
      });
      return { success: true, message: `Subagent ${session_id} registered under parent ${event.parent_session_id}` };
    }

    case 'subagent_stop': {
      // Mark subagent as completed but don't remove (for history)
      sessionStore.upsert(session_id, {
        status: 'completed',
        alerting: false,
      });
      return { success: true, message: `Subagent ${session_id} completed` };
    }

    case 'todo_update': {
      // Update session with current todo list
      if (event.todos) {
        // Find the in_progress task to use as currentTask
        const inProgress = event.todos.find(t => t.status === 'in_progress');
        sessionStore.upsert(session_id, {
          todos: event.todos,
          currentTask: inProgress?.activeForm,
        });
      }
      return { success: true, message: `Session ${session_id} todos updated` };
    }

    case 'plan_update': {
      // Update session with plan context
      if (event.plan_name) {
        const plan: PlanContext = {
          name: event.plan_name,
          steps: event.plan_steps || [],
          currentStep: event.plan_current_step,
          filePath: event.plan_file_path,
        };
        sessionStore.upsert(session_id, { plan });
      } else {
        // Clear plan if no name provided (plan mode exited)
        sessionStore.upsert(session_id, { plan: undefined });
      }
      return { success: true, message: `Session ${session_id} plan updated` };
    }

    default:
      return { success: false, message: `Unknown event type` };
  }
}

/**
 * Handle action requests (send input to sessions)
 */
async function handleAction(req: ActionRequest): Promise<{ success: boolean; message: string }> {
  const session = sessionStore.get(req.session_id);
  if (!session) {
    return { success: false, message: 'Session not found' };
  }

  // Determine what to send based on action type
  let textToSend: string;
  switch (req.action) {
    case 'approve':
      textToSend = 'y';
      break;
    case 'deny':
      textToSend = 'n';
      break;
    case 'cancel':
      textToSend = 'Escape';  // Send escape key
      break;
    case 'respond':
      if (!req.response) {
        return { success: false, message: 'Response text required' };
      }
      textToSend = req.response;
      break;
    case 'focus': {
      // Focus terminal doesn't need text sending - handle separately
      const focusResult = await focusTerminal(session);
      if (focusResult.success) {
        return { success: true, message: `Focused ${session.name}` };
      }
      return { success: false, message: focusResult.error || 'Failed to focus terminal' };
    }
    default:
      return { success: false, message: 'Unknown action type' };
  }

  // Route to appropriate terminal handler
  if (session.terminal.type === 'tmux' && session.terminal.id) {
    const result = await sendToTmux(session.terminal.id, textToSend);
    if (result.success) {
      sessionStore.clearPending(req.session_id);
      return { success: true, message: `Sent "${textToSend}" to ${session.name}` };
    }
    return { success: false, message: result.error || 'Failed to send to tmux' };
  }

  // For VS Code / iTerm2 - not yet implemented
  if (session.terminal.type === 'vscode') {
    return { success: false, message: 'VS Code quick actions require extension (coming soon)' };
  }

  if (session.terminal.type === 'iterm2') {
    return { success: false, message: 'iTerm2 quick actions not yet implemented' };
  }

  return { success: false, message: `Cannot send to terminal type: ${session.terminal.type}` };
}

/**
 * Start the HTTP server for receiving hook events
 */
export function startServer(port: number = DEFAULT_PORT): { port: number; stop: () => void } {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // Health check
      if (url.pathname === '/health') {
        return Response.json({ status: 'ok', sessions: sessionStore.all().length });
      }

      // List sessions
      if (url.pathname === '/sessions' && req.method === 'GET') {
        return Response.json(sessionStore.sorted());
      }

      // Get single session
      if (url.pathname.startsWith('/sessions/') && req.method === 'GET') {
        const sessionId = url.pathname.slice('/sessions/'.length);
        const session = sessionStore.get(sessionId);
        if (!session) {
          return Response.json({ error: 'Session not found' }, { status: 404 });
        }
        return Response.json(session);
      }

      // Receive hook events
      if (url.pathname === '/event' && req.method === 'POST') {
        try {
          const body = await req.json() as HookEvent;
          const result = handleHookEvent(body);
          return Response.json(result, { status: result.success ? 200 : 400 });
        } catch (err) {
          return Response.json({ success: false, message: String(err) }, { status: 400 });
        }
      }

      // Send action to session
      if (url.pathname === '/action' && req.method === 'POST') {
        try {
          const body = await req.json() as ActionRequest;
          const result = await handleAction(body);
          return Response.json(result, { status: result.success ? 200 : 400 });
        } catch (err) {
          return Response.json({ success: false, message: String(err) }, { status: 400 });
        }
      }

      // Cleanup stale sessions
      if (url.pathname === '/cleanup' && req.method === 'POST') {
        const cleaned = sessionStore.cleanupStaleSessions();
        return Response.json({ success: true, cleaned });
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    },
  });

  const actualPort = server.port ?? port;
  console.log(`Session manager server running on http://localhost:${actualPort}`);

  return {
    port: actualPort,
    stop: () => server.stop(),
  };
}

export { DEFAULT_PORT };
