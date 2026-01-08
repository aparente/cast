import { sessionStore } from './store.js';
import type { SessionStatus, TerminalType, QuickActionType } from './types.js';

const DEFAULT_PORT = 7432; // "SSMGR" on phone keypad :)

interface HookEvent {
  event: 'session_start' | 'session_end' | 'notification' | 'tool_use' | 'status_change' | 'subagent_start' | 'subagent_stop';
  session_id: string;
  cwd?: string;
  message?: string;
  tool_name?: string;
  status?: SessionStatus;
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
 * Send input to a tmux pane
 */
async function sendToTmux(paneTarget: string, text: string): Promise<{ success: boolean; error?: string }> {
  try {
    const proc = Bun.spawn(['tmux', 'send-keys', '-t', paneTarget, text, 'Enter'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return { success: false, error: stderr || `Exit code ${exitCode}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Handle incoming hook events
 */
function handleHookEvent(event: HookEvent): { success: boolean; message: string } {
  const { session_id, cwd } = event;

  switch (event.event) {
    case 'session_start': {
      sessionStore.upsert(session_id, {
        name: deriveSessionName(cwd),
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
      return { success: true, message: `Session ${session_id} registered` };
    }

    case 'session_end': {
      sessionStore.remove(session_id);
      return { success: true, message: `Session ${session_id} removed` };
    }

    case 'notification': {
      sessionStore.upsert(session_id, {
        status: 'needs_input',
        alerting: true,
        currentTask: event.message || 'Waiting for input',
        pendingMessage: event.message,
      });
      return { success: true, message: `Session ${session_id} alerting` };
    }

    case 'tool_use': {
      sessionStore.upsert(session_id, {
        status: 'working',
        alerting: false,
        currentTask: event.tool_name ? `Using ${event.tool_name}` : undefined,
        pendingMessage: undefined,  // Clear pending on tool use
      });
      return { success: true, message: `Session ${session_id} tool use recorded` };
    }

    case 'status_change': {
      if (event.status) {
        sessionStore.upsert(session_id, {
          status: event.status,
          alerting: event.status === 'needs_input',
        });
      }
      return { success: true, message: `Session ${session_id} status updated` };
    }

    case 'subagent_start': {
      // Register a new subagent with parent relationship
      // Use description if available, otherwise fall back to type
      let name: string;
      if (event.description) {
        // Truncate long descriptions but keep them readable
        const desc = event.description.length > 30
          ? event.description.slice(0, 27) + '...'
          : event.description;
        name = event.subagent_type ? `${desc} (${event.subagent_type})` : desc;
      } else if (event.subagent_type) {
        name = `${deriveSessionName(cwd)} (${event.subagent_type})`;
      } else {
        name = deriveSessionName(cwd);
      }

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
