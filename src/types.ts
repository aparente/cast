/**
 * Represents the status of a Claude Code session
 */
export type SessionStatus =
  | 'idle'           // Waiting, no active work
  | 'working'        // Claude is processing/generating
  | 'needs_input'    // Waiting for user input/approval
  | 'error'          // Something went wrong
  | 'completed';     // Task finished

/**
 * Terminal types we can send input to
 */
export type TerminalType = 'tmux' | 'vscode' | 'iterm2' | 'unknown';

/**
 * Terminal context for quick actions
 */
export interface TerminalContext {
  type: TerminalType;
  id: string;           // tmux pane target, iTerm session ID, etc.
  shellPid?: number;    // Shell process ID
  ttyPath?: string;     // TTY device path
}

/**
 * Quick action types
 */
export type QuickActionType = 'approve' | 'deny' | 'respond' | 'cancel';

/**
 * Todo item status
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

/**
 * A todo item from Claude's TodoWrite tool
 */
export interface TodoItem {
  content: string;      // Task description (imperative form)
  activeForm: string;   // Present continuous form (e.g., "Writing tests")
  status: TodoStatus;
}

/**
 * A Claude Code session running in a terminal
 */
export interface ClaudeSession {
  id: string;
  name: string;
  status: SessionStatus;
  projectPath?: string;
  currentTask?: string;
  pendingMessage?: string;  // What Claude is asking/waiting for
  lastActivity: Date;
  alerting: boolean;
  terminal: TerminalContext;
  // Subagent hierarchy
  parentId?: string;        // If this is a subagent, the parent session ID
  // Task tracking from TodoWrite
  todos?: TodoItem[];       // Current todo list
  lastStatus?: string;      // Parsed status from last Claude message
}

/**
 * Aggregated status for a session including its children
 */
export interface AggregatedStatus {
  status: SessionStatus;
  alerting: boolean;
  childCount: number;
  alertingChildCount: number;
}

/**
 * Dashboard view modes
 */
export type ViewMode = 'list' | 'kanban' | 'detail';

/**
 * Kanban columns for session organization
 */
export interface KanbanColumn {
  id: string;
  title: string;
  statuses: SessionStatus[];
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'waiting', title: 'Needs Input', statuses: ['needs_input'] },
  { id: 'working', title: 'Working', statuses: ['working'] },
  { id: 'idle', title: 'Idle', statuses: ['idle', 'completed'] },
];

/**
 * Status priority for sorting and bubbling (lower = higher priority)
 * Centralized to avoid duplication across files
 */
export const STATUS_PRIORITY: Record<SessionStatus, number> = {
  needs_input: 0,
  error: 1,
  working: 2,
  idle: 3,
  completed: 4,
};

/**
 * Check if quick actions are available for a session
 */
export function canSendInput(session: ClaudeSession): boolean {
  return session.terminal.type === 'tmux' && session.terminal.id !== '';
}
