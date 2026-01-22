import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { sessionStore } from '../store.js';
import { DEFAULT_PORT } from '../server.js';
import type { ClaudeSession, ViewMode, SessionStatus, QuickActionType, AggregatedStatus, AttentionType } from '../types.js';
import { canSendInput } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// ▓▓▓ CYBERPUNK TERMINAL DESIGN SYSTEM ▓▓▓
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// COLOR PALETTE - Cyberpunk: magenta/cyan on dark
// ─────────────────────────────────────────────────────────────

export const COLORS = {
  // Accent for attention - bold white stands out without being garish
  accent: 'whiteBright',

  // Status colors
  idle: 'gray',
  working: 'cyanBright',        // Blue for active work
  needs_input: 'whiteBright',   // Bold white for attention
  error: 'red',
  completed: 'gray',

  // UI elements
  border: 'gray',
  borderFocus: 'cyanBright',
  text: 'white',
  textDim: 'gray',
  success: 'green',
  warning: 'red',
} as const;

// Status colors mapped
export const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: COLORS.idle,
  working: COLORS.working,
  needs_input: COLORS.needs_input,
  error: COLORS.error,
  completed: COLORS.completed,
};

// ─────────────────────────────────────────────────────────────
// UNICODE SYMBOLS & DECORATIONS
// ─────────────────────────────────────────────────────────────

export const SYMBOLS = {
  // Status indicators
  statusIdle: '◇',       // Empty diamond - idle
  statusWorking: '◈',    // Filled diamond - working
  statusAlert: '◆',      // Solid diamond - needs attention
  statusError: '✖',      // X mark - error
  statusDone: '◇',       // Empty - completed

  // Tree navigation
  treeBranch: '├─',
  treeLast: '└─',
  treeVert: '│ ',
  treeExpand: '▸',       // Collapsed
  treeCollapse: '▾',     // Expanded

  // Selection & action
  selected: '▶',
  bullet: '›',
  actionable: '⚡',

  // Progress
  progressFull: '█',
  progressHalf: '▓',
  progressEmpty: '░',

  // Sparkline characters (for mini activity graphs)
  spark: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],

  // Separators
  dividerLight: '─',
  dividerHeavy: '━',
  dividerDouble: '═',

  // Corners (heavy)
  cornerTL: '┏',
  cornerTR: '┓',
  cornerBL: '┗',
  cornerBR: '┛',

  // Corners (rounded)
  roundTL: '╭',
  roundTR: '╮',
  roundBL: '╰',
  roundBR: '╯',
} as const;

// ─────────────────────────────────────────────────────────────
// ASCII ART HEADER
// ─────────────────────────────────────────────────────────────

export const CAST_LOGO = [
  '╔═══╗ ╔═══╗ ╔═══╗ ╔════╗',
  '║ ╔═╝ ║ ╔═╣ ║ ══╣ ╚═╗╔═╝',
  '║ ╚═╗ ║ ╚═╣ ╠══ ║   ║║  ',
  '╚═══╝ ╚═══╝ ╚═══╝   ╚╝  ',
];

export const CAST_LOGO_MINI = '▓▒░ CAST ░▒▓';

// ─────────────────────────────────────────────────────────────
// STATUS VOCABULARY (playful but terse)
// ─────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<SessionStatus, string[]> = {
  idle: ['idle', 'chill', 'zen', 'quiet', 'paused'],
  working: ['busy', 'active', 'grinding', 'cooking', 'hacking'],
  needs_input: ['waiting', 'blocked', 'needs you', 'alert', 'stuck'],
  error: ['error', 'failed', 'crashed', 'oops', 'broken'],
  completed: ['done', 'finished', 'complete', '✓', 'shipped'],
};

export function getStatusLabel(status: SessionStatus, sessionId: string): string {
  const labels = STATUS_LABELS[status];
  const index = sessionId.charCodeAt(0) % labels.length;
  return labels[index] ?? labels[0] ?? status;
}

export function getStatusSymbol(status: SessionStatus, alerting: boolean): string {
  if (alerting) return SYMBOLS.statusAlert;
  switch (status) {
    case 'idle': return SYMBOLS.statusIdle;
    case 'working': return SYMBOLS.statusWorking;
    case 'needs_input': return SYMBOLS.statusAlert;
    case 'error': return SYMBOLS.statusError;
    case 'completed': return SYMBOLS.statusDone;
    default: return SYMBOLS.statusIdle;
  }
}

// ─────────────────────────────────────────────────────────────
// SESSION EMOJI (context-aware)
// ─────────────────────────────────────────────────────────────

export function getSessionEmoji(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('bio') || lower.includes('lab') || lower.includes('health')) return '🧬';
  if (lower.includes('grant') || lower.includes('money') || lower.includes('finance')) return '💰';
  if (lower.includes('web') || lower.includes('site') || lower.includes('frontend')) return '🌐';
  if (lower.includes('api') || lower.includes('server') || lower.includes('backend')) return '⚡';
  if (lower.includes('test') || lower.includes('spec')) return '🧪';
  if (lower.includes('doc') || lower.includes('readme')) return '📝';
  if (lower.includes('data') || lower.includes('scrape')) return '📊';
  if (lower.includes('ai') || lower.includes('ml') || lower.includes('claude')) return '🤖';
  if (lower.includes('cast') || lower.includes('session')) return '🦀';
  const creatures = ['🦀', '🐙', '🦑', '🐡', '🦐', '🦞'] as const;
  return creatures[name.length % creatures.length] ?? '🦀';
}

// ─────────────────────────────────────────────────────────────
// HYPERLINK SUPPORT (OSC8)
// ─────────────────────────────────────────────────────────────

function getEditorCommand(): string {
  const editor = process.env.EDITOR || '';
  if (editor.includes('cursor')) return 'cursor';
  if (editor.includes('code') || editor.includes('Code')) return 'code';
  return 'cursor';
}

function buildEditorUrl(path: string): string {
  const editor = getEditorCommand();
  if (editor === 'code') return `vscode://file${path}`;
  if (editor === 'cursor') return `cursor://file${path}`;
  return `file://${path}`;
}

function Hyperlink({ url, children }: { url: string; children: React.ReactNode }) {
  const start = `\x1b]8;;${url}\x07`;
  const end = `\x1b]8;;\x07`;
  return <Text>{start}{children}{end}</Text>;
}

interface DashboardProps {
  viewMode?: ViewMode;
  serverPort?: number;
}

// ─────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

export function getProgress(session: ClaudeSession): { completed: number; total: number } | null {
  if (session.plan && session.plan.steps.length > 0) {
    const completed = session.plan.steps.filter(s => s.completed).length;
    return { completed, total: session.plan.steps.length };
  }
  if (session.todos && session.todos.length > 0) {
    const completed = session.todos.filter(t => t.status === 'completed').length;
    return { completed, total: session.todos.length };
  }
  return null;
}

function getCurrentPlanStep(session: ClaudeSession): string | null {
  if (!session.plan || session.plan.steps.length === 0) return null;
  if (session.plan.currentStep !== undefined) {
    const step = session.plan.steps[session.plan.currentStep];
    if (step) return step.title;
  }
  const incompleteStep = session.plan.steps.find(s => !s.completed);
  return incompleteStep?.title ?? null;
}

export function extractCompletionSummary(lastStatus: string): string {
  let text = lastStatus.replace(/[*_`#]/g, '').trim();
  const sentenceMatch = text.match(/^([^.!?]+[.!?]?)/);
  if (sentenceMatch?.[1]) {
    text = sentenceMatch[1].trim();
  }
  if (text.length > 40) {
    text = text.slice(0, 37) + '...';
  }
  return text;
}

export function getCurrentTask(session: ClaudeSession): string {
  if (session.todos) {
    const inProgress = session.todos.find(t => t.status === 'in_progress');
    if (inProgress) return inProgress.activeForm;
  }
  if (session.status === 'working' && session.currentTask) {
    return session.currentTask;
  }
  if (session.status === 'needs_input') {
    if (session.lastStatus) {
      const summary = extractCompletionSummary(session.lastStatus);
      return `${summary}, waiting…`;
    }
    return session.pendingMessage || 'Waiting for input…';
  }
  if (session.lastStatus) {
    return session.lastStatus;
  }
  return session.currentTask || '';
}

// ─────────────────────────────────────────────────────────────
// CUSTOM COMPONENTS
// ─────────────────────────────────────────────────────────────

/**
 * Simple progress display - just text, no bar
 */
function ProgressText({ completed, total }: { completed: number; total: number }) {
  if (total === 0) return <Text dimColor>—</Text>;
  const done = completed === total;
  return (
    <Text color={done ? COLORS.success : undefined} dimColor={!done}>
      {completed}/{total}
    </Text>
  );
}

/**
 * Status badge with symbol and color
 */
function StatusBadge({ status, alerting, showLabel = true }: { status: SessionStatus; alerting: boolean; showLabel?: boolean }) {
  const symbol = getStatusSymbol(status, alerting);
  const color = STATUS_COLORS[status];

  return (
    <Text color={color} bold={alerting}>
      {symbol}{showLabel && ` ${status}`}
    </Text>
  );
}

/**
 * Divider line
 */
function Divider({ char = '─', width = 40, color = 'gray' }: { char?: string; width?: number; color?: string }) {
  return <Text color={color}>{char.repeat(width)}</Text>;
}

// ─────────────────────────────────────────────────────────────
// QUICK ACTIONS
// ─────────────────────────────────────────────────────────────

async function sendAction(sessionId: string, action: QuickActionType, response?: string): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${DEFAULT_PORT}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, action, response }),
    });
    const data = await res.json() as { success: boolean };
    return data.success;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// ▓▓▓ DETAIL VIEW ▓▓▓
// ═══════════════════════════════════════════════════════════════

function DetailView({ session, onClose }: { session: ClaudeSession; onClose: () => void }) {
  const [responding, setResponding] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const emoji = getSessionEmoji(session.name);
  const canAct = canSendInput(session);
  const progress = getProgress(session);

  const handleAction = async (action: QuickActionType, text?: string) => {
    setActionStatus('sending...');
    const success = await sendAction(session.id, action, text);
    if (success) {
      setActionStatus('✓ sent');
      if (action !== 'focus') {
        setTimeout(onClose, 500);
      } else {
        setTimeout(() => setActionStatus(null), 1500);
      }
    } else {
      setActionStatus('✖ failed');
    }
  };

  useInput((input, key) => {
    if (responding) {
      if (key.escape) {
        setResponding(false);
        setResponseText('');
      }
      if (key.return && responseText.trim()) {
        handleAction('respond', responseText);
      }
      return;
    }

    if (key.escape || input === 'q') {
      onClose();
    }
    if (input === 'o') {
      handleAction('focus');
    }
    if (canAct && session.alerting) {
      if (input === 'y') handleAction('approve');
      if (input === 'n') handleAction('deny');
      if (input === 'r') setResponding(true);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={COLORS.borderFocus} paddingX={2} paddingY={1}>
      {/* ── Header ── */}
      <Box marginBottom={1}>
        <Text bold color={COLORS.accent}>{emoji} {session.name}</Text>
        <Text dimColor>  </Text>
        {session.projectPath ? (
          <Hyperlink url={buildEditorUrl(session.projectPath)}>
            <Text dimColor underline>{session.projectPath}</Text>
          </Hyperlink>
        ) : (
          <Text dimColor>no project path</Text>
        )}
      </Box>

      <Divider char="─" width={50} />

      {/* ── Status Row ── */}
      <Box marginY={1}>
        <Box width={20}>
          <Text dimColor>status </Text>
          <StatusBadge status={session.status} alerting={session.alerting} />
        </Box>
        <Box width={20}>
          <Text dimColor>terminal </Text>
          <Text color={canAct ? COLORS.success : COLORS.textDim}>
            {session.terminal.type}
            {session.terminal.id ? ` (${session.terminal.id.slice(0, 8)})` : ''}
          </Text>
        </Box>
        {canAct && <Text color={COLORS.success}>{SYMBOLS.actionable} actions</Text>}
      </Box>

      {/* ── Progress ── */}
      {progress && (
        <Box marginBottom={1}>
          <Text dimColor>progress </Text>
          <ProgressText completed={progress.completed} total={progress.total} />
        </Box>
      )}

      {/* ── Plan Context ── */}
      {session.plan && (
        <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor={COLORS.working} paddingX={1}>
          <Box>
            <Text bold color={COLORS.working}>◈ {session.plan.name}</Text>
            {session.plan.steps.length > 0 && (
              <Text dimColor> ({session.plan.steps.filter(s => s.completed).length}/{session.plan.steps.length})</Text>
            )}
          </Box>
          {getCurrentPlanStep(session) && (
            <Box marginTop={1}>
              <Text dimColor>{SYMBOLS.bullet} </Text>
              <Text>{getCurrentPlanStep(session)}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* ── Claude's Last Message ── */}
      {session.lastStatus && session.alerting && (
        <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor={COLORS.textDim} paddingX={1}>
          <Text bold dimColor>claude said:</Text>
          <Text dimColor>{session.lastStatus.slice(0, 200)}{session.lastStatus.length > 200 ? '...' : ''}</Text>
        </Box>
      )}

      {/* ── Pending Message ── */}
      {session.pendingMessage && (
        <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor={COLORS.accent} paddingX={1}>
          <Text bold color={COLORS.accent}>◆ waiting for input:</Text>
          <Text>{session.pendingMessage}</Text>
        </Box>
      )}

      {/* ── Quick Actions ── */}
      {canAct && session.alerting && !responding && (
        <Box marginTop={1}>
          <Text bold dimColor>actions: </Text>
          <Text color={COLORS.success}>[y] approve </Text>
          <Text color={COLORS.error}>[n] deny </Text>
          <Text color={COLORS.working}>[r] respond </Text>
        </Box>
      )}

      {/* ── Response Input ── */}
      {responding && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={COLORS.working}>response (enter to send, esc to cancel):</Text>
          <Box borderStyle="single" borderColor={COLORS.working} paddingX={1}>
            <TextInput
              value={responseText}
              onChange={setResponseText}
              placeholder="type here..."
            />
          </Box>
        </Box>
      )}

      {/* ── Action Status ── */}
      {actionStatus && (
        <Box marginTop={1}>
          <Text color={actionStatus.includes('✓') ? COLORS.success : actionStatus.includes('✖') ? COLORS.error : COLORS.warning}>
            {actionStatus}
          </Text>
        </Box>
      )}

      {/* ── Footer ── */}
      <Box marginTop={1}>
        <Text dimColor>[esc] back  [o] jump to terminal</Text>
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════
// ▓▓▓ LIST VIEW ▓▓▓
// ═══════════════════════════════════════════════════════════════

// Fixed column widths - minimal, efficient
export const COL = {
  TREE: 4,
  EMOJI: 3,
  NAME: 24,
  STATUS: 12,
  PROGRESS: 8,   // Fits "PROGRESS" header and "11/11"
  ALERT: 2,
  TASK: 50,
} as const;

interface SessionRowProps {
  session: ClaudeSession;
  selected: boolean;
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  aggregatedStatus?: AggregatedStatus;
}

function SessionRow({ session, selected, depth = 0, hasChildren = false, expanded = true, aggregatedStatus }: SessionRowProps) {
  const aggStatus = aggregatedStatus || sessionStore.getAggregatedStatus(session.id);
  const displayStatus = aggStatus.alerting ? aggStatus.status : session.status;
  const color = STATUS_COLORS[displayStatus];
  const emoji = getSessionEmoji(session.name);
  const statusLabel = getStatusLabel(displayStatus, session.id);
  const canAct = canSendInput(session);
  const progress = getProgress(session);
  const currentTask = getCurrentTask(session);

  // Pulse animation for alerting rows
  const [pulse, setPulse] = useState(true);
  useEffect(() => {
    if (session.alerting || aggStatus.alertingChildCount > 0) {
      const interval = setInterval(() => setPulse(p => !p), 600);
      return () => clearInterval(interval);
    }
  }, [session.alerting, aggStatus.alertingChildCount]);

  // Tree prefix
  const indent = '  '.repeat(Math.min(depth, 2));
  const treeChar = hasChildren
    ? (expanded ? SYMBOLS.treeCollapse : SYMBOLS.treeExpand)
    : (depth > 0 ? SYMBOLS.bullet : ' ');
  const selChar = selected ? SYMBOLS.selected : ' ';

  // Build name with child count badge
  const childBadge = hasChildren ? ` (${aggStatus.childCount})` : '';
  const maxNameLen = COL.NAME - childBadge.length;
  const truncatedName = session.name.length > maxNameLen
    ? session.name.slice(0, maxNameLen - 1) + '…'
    : session.name;

  // Alert indicator with pulse effect
  let alertChar = ' ';
  let alertColor: string | undefined;
  if (session.alerting) {
    alertChar = pulse ? SYMBOLS.statusAlert : '○';
    alertColor = session.attentionType === 'critical' ? COLORS.success : COLORS.accent;
  } else if (aggStatus.alertingChildCount > 0) {
    alertChar = pulse ? '!' : '·';
    alertColor = COLORS.accent;
  }

  return (
    <Box flexDirection="row" paddingX={1}>
      {/* Selection + Tree */}
      <Box width={COL.TREE}>
        <Text color={selected ? COLORS.accent : COLORS.textDim} bold={selected}>
          {selChar}{indent}{treeChar}
        </Text>
      </Box>

      {/* Emoji */}
      <Box width={COL.EMOJI}>
        <Text>{emoji}</Text>
      </Box>

      {/* Name */}
      <Box width={COL.NAME}>
        <Text color={aggStatus.alerting ? COLORS.accent : undefined} bold={aggStatus.alerting || selected}>
          {truncatedName}
          <Text dimColor>{childBadge}</Text>
        </Text>
      </Box>

      {/* Status with spinner */}
      <Box width={COL.STATUS}>
        {displayStatus === 'working' ? (
          <Text color={color}>
            <Spinner type="dots" /> {statusLabel.slice(0, COL.STATUS - 3)}
          </Text>
        ) : (
          <Text color={color}>{statusLabel.slice(0, COL.STATUS)}</Text>
        )}
      </Box>

      {/* Progress */}
      <Box width={COL.PROGRESS}>
        {progress ? (
          <ProgressText completed={progress.completed} total={progress.total} />
        ) : (
          <Text dimColor>{'—'.padEnd(COL.PROGRESS)}</Text>
        )}
      </Box>

      {/* Alert */}
      <Box width={COL.ALERT}>
        <Text color={alertColor} bold={alertChar !== ' '}>
          {alertChar}
        </Text>
      </Box>

      {/* Task - flexGrow to fill remaining space */}
      <Box flexGrow={1} minWidth={COL.TASK}>
        <Text dimColor>{currentTask || '—'}</Text>
      </Box>
    </Box>
  );
}

/**
 * Recursive tree component
 */
function SessionTree({
  session,
  depth = 0,
  selectedId,
  expandedIds,
  showCompleted,
}: {
  session: ClaudeSession;
  depth?: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  showCompleted: boolean;
}) {
  let children = sessionStore.getChildren(session.id);
  if (!showCompleted) {
    children = children.filter(c => c.status !== 'completed');
  }

  const hasChildren = children.length > 0;
  const expanded = expandedIds.has(session.id);
  const aggStatus = sessionStore.getAggregatedStatus(session.id);

  return (
    <>
      <SessionRow
        session={session}
        selected={session.id === selectedId}
        depth={depth}
        hasChildren={hasChildren}
        expanded={expanded}
        aggregatedStatus={aggStatus}
      />
      {expanded && children.map(child => (
        <SessionTree
          key={child.id}
          session={child}
          depth={depth + 1}
          selectedId={selectedId}
          expandedIds={expandedIds}
          showCompleted={showCompleted}
        />
      ))}
    </>
  );
}

interface ListViewProps {
  sessions: ClaudeSession[];
  selectedIndex: number;
  expandedIds: Set<string>;
  flattenedSessions: ClaudeSession[];
  showCompleted: boolean;
}

function ListView({ sessions, selectedIndex, expandedIds, flattenedSessions, showCompleted }: ListViewProps) {
  let rootSessions = sessionStore.sortedRoots();
  if (!showCompleted) {
    rootSessions = rootSessions.filter(s => s.status !== 'completed');
  }
  const selectedSession = flattenedSessions[selectedIndex];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.border}>
      {/* Header row */}
      <Box paddingX={1} borderStyle="single" borderColor={COLORS.border} borderTop={false} borderLeft={false} borderRight={false}>
        <Box width={COL.TREE}><Text dimColor>{''}</Text></Box>
        <Box width={COL.EMOJI}><Text dimColor>{''}</Text></Box>
        <Box width={COL.NAME}><Text bold dimColor>SESSION</Text></Box>
        <Box width={COL.STATUS}><Text bold dimColor>STATUS</Text></Box>
        <Box width={COL.PROGRESS}><Text bold dimColor>#</Text></Box>
        <Box width={COL.ALERT}><Text bold dimColor>!</Text></Box>
        <Box flexGrow={1} minWidth={COL.TASK}><Text bold dimColor>TASK</Text></Box>
      </Box>

      {/* Session rows */}
      {rootSessions.map(session => (
        <SessionTree
          key={session.id}
          session={session}
          selectedId={selectedSession?.id || null}
          expandedIds={expandedIds}
          showCompleted={showCompleted}
        />
      ))}
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════
// ▓▓▓ KANBAN VIEW ▓▓▓
// ═══════════════════════════════════════════════════════════════

interface KanbanColumnDef {
  id: string;
  title: string;
  symbol: string;
  color: string;
  statuses: SessionStatus[];
}

export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  { id: 'attention', title: 'NEEDS YOU', symbol: SYMBOLS.statusAlert, color: COLORS.accent, statuses: ['needs_input', 'error'] },
  { id: 'working', title: 'WORKING', symbol: SYMBOLS.statusWorking, color: COLORS.working, statuses: ['working'] },
  { id: 'idle', title: 'IDLE', symbol: SYMBOLS.statusIdle, color: COLORS.idle, statuses: ['idle', 'completed'] },
];

function KanbanCard({ session, selected, isSubagent }: { session: ClaudeSession; selected: boolean; isSubagent: boolean }) {
  const emoji = getSessionEmoji(session.name);
  const borderColor = selected ? COLORS.borderFocus : (session.alerting ? COLORS.accent : COLORS.border);
  const canAct = canSendInput(session);
  const progress = getProgress(session);

  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? 'double' : 'round'}
      borderColor={borderColor}
      paddingX={1}
      marginBottom={1}
      marginLeft={isSubagent ? 1 : 0}
    >
      {isSubagent && (
        <Text dimColor>{SYMBOLS.treeBranch} subtask</Text>
      )}
      <Box>
        <Text bold={selected || session.alerting} color={session.alerting ? COLORS.accent : undefined}>
          {emoji} {session.name.slice(0, 14)}
        </Text>
        {canAct && session.alerting && <Text color={COLORS.success}> {SYMBOLS.actionable}</Text>}
      </Box>
      <Box>
        {session.status === 'working' ? (
          <Text color={COLORS.working}>
            <Spinner type="dots" /> {getStatusLabel(session.status, session.id)}
          </Text>
        ) : (
          <Text dimColor>{getStatusLabel(session.status, session.id)}</Text>
        )}
      </Box>
      {progress && (
        <ProgressText completed={progress.completed} total={progress.total} />
      )}
    </Box>
  );
}

function KanbanColumn({ column, sessions, selectedId, showCompleted }: {
  column: KanbanColumnDef;
  sessions: ClaudeSession[];
  selectedId: string | null;
  showCompleted: boolean;
}) {
  let columnSessions = sessions.filter(s => column.statuses.includes(s.status));

  if (!showCompleted) {
    columnSessions = columnSessions.filter(s => {
      if (!s.parentId) return true;
      return s.status !== 'completed';
    });
  }

  const rootCount = columnSessions.filter(s => !s.parentId).length;
  const subagentCount = columnSessions.filter(s => s.parentId).length;

  return (
    <Box flexDirection="column" width="33%" paddingX={1}>
      <Box marginBottom={1} borderStyle="single" borderColor={column.color} borderTop={false} borderLeft={false} borderRight={false}>
        <Text bold color={column.color}>
          {column.symbol} {column.title}
        </Text>
        <Text dimColor> ({rootCount}{subagentCount > 0 ? `+${subagentCount}` : ''})</Text>
      </Box>
      {columnSessions.length === 0 ? (
        <Text dimColor>—</Text>
      ) : (
        columnSessions.map(session => (
          <KanbanCard
            key={session.id}
            session={session}
            selected={session.id === selectedId}
            isSubagent={!!session.parentId}
          />
        ))
      )}
    </Box>
  );
}

function KanbanView({ sessions, selectedIndex, showCompleted }: { sessions: ClaudeSession[]; selectedIndex: number; showCompleted: boolean }) {
  const selectedId = sessions[selectedIndex]?.id ?? null;

  return (
    <Box borderStyle="round" borderColor={COLORS.border} padding={1}>
      <Box flexDirection="row" width="100%">
        {KANBAN_COLUMNS.map(column => (
          <KanbanColumn
            key={column.id}
            column={column}
            sessions={sessions}
            selectedId={selectedId}
            showCompleted={showCompleted}
          />
        ))}
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════
// ▓▓▓ HEADER ▓▓▓
// ═══════════════════════════════════════════════════════════════

function Header({ serverPort, view, showCompleted, alertCount = 0 }: { serverPort?: number; view: ViewMode; showCompleted: boolean; alertCount?: number }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Logo bar - static, no animation */}
      <Box borderStyle="round" borderColor={COLORS.border} paddingX={2}>
        <Text bold>🦀</Text>
        <Text bold> {CAST_LOGO_MINI}</Text>
        {serverPort && <Text dimColor> :{serverPort}</Text>}
        <Text>   </Text>
        <Text color={view === 'list' ? COLORS.accent : COLORS.textDim} bold={view === 'list'}>[L]ist</Text>
        <Text>  </Text>
        <Text color={view === 'kanban' ? COLORS.accent : COLORS.textDim} bold={view === 'kanban'}>[K]anban</Text>
        <Text>   </Text>
        <Text color={showCompleted ? COLORS.success : COLORS.textDim}>[C]ompleted {showCompleted ? '✓' : '○'}</Text>
      </Box>

      {/* Keybindings */}
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          ↑↓ nav  enter detail  o jump  d done  D cleanup  P prune  q quit
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>alert: </Text>
        <Text color={COLORS.accent}>{SYMBOLS.statusAlert}</Text><Text dimColor>=needs you  </Text>
        <Text color={COLORS.success}>{SYMBOLS.statusAlert}</Text><Text dimColor>=actionable  </Text>
        <Text dimColor>│ in detail: </Text>
        <Text color={COLORS.success}>y</Text><Text dimColor>/</Text>
        <Text color={COLORS.error}>n</Text><Text dimColor>/</Text>
        <Text color={COLORS.working}>r</Text>
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════
// ▓▓▓ STATUS BAR ▓▓▓
// ═══════════════════════════════════════════════════════════════

function StatusBar({ sessions }: { sessions: ClaudeSession[] }) {
  const rootSessions = sessions.filter(s => !s.parentId);
  const subagents = sessions.filter(s => s.parentId);
  const activeSubagents = subagents.filter(s => s.status !== 'completed');
  const completedSubagents = subagents.filter(s => s.status === 'completed');

  const alerting = sessions.filter(s => s.alerting).length;
  const working = sessions.filter(s => s.status === 'working').length;
  const actionable = sessions.filter(s => s.alerting && canSendInput(s)).length;

  // Status vibe
  let vibe = '';
  let vibeColor: string = COLORS.textDim;
  if (alerting > 0) {
    vibe = alerting === 1 ? '◆ attention needed' : `◆ ${alerting} need attention`;
    vibeColor = COLORS.accent;
  } else if (working > 0) {
    vibe = working === 1 ? '◈ 1 active' : `◈ ${working} active`;
    vibeColor = COLORS.working;
  } else if (sessions.length > 0) {
    vibe = '◇ all quiet';
  }

  const workingRoots = rootSessions.filter(s => s.status === 'working').length;

  return (
    <Box marginTop={1} paddingX={1} borderStyle="single" borderColor={COLORS.border} borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Text>
        <Text bold>{rootSessions.length}</Text>
        <Text dimColor> session{rootSessions.length !== 1 ? 's' : ''}</Text>
        {workingRoots > 0 && (
          <Text color={COLORS.working}> ({workingRoots} working)</Text>
        )}
        {subagents.length > 0 && (
          <Text dimColor>
            {' │ '}<Text color={COLORS.working}>{activeSubagents.length}</Text> active
            {completedSubagents.length > 0 && <Text> / <Text color={COLORS.textDim}>{completedSubagents.length}</Text> done</Text>}
            {' subtask'}{subagents.length !== 1 ? 's' : ''}
          </Text>
        )}
        {actionable > 0 && <Text color={COLORS.success}> │ {actionable} {SYMBOLS.actionable} actionable</Text>}
        <Text color={vibeColor}>  {vibe}</Text>
      </Text>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════
// ▓▓▓ EMPTY STATE ▓▓▓
// ═══════════════════════════════════════════════════════════════

function EmptyState() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setFrame(f => f + 1), 150);
    return () => clearInterval(interval);
  }, []);

  // Animated crab walk with cyberpunk flair
  const frames = [
    '       🦀      ',
    '      🦀       ',
    '     🦀        ',
    '    🦀         ',
    '   🦀          ',
    '  🦀           ',
    ' 🦀            ',
    '🦀             ',
    ' 🦀            ',
    '  🦀           ',
    '   🦀          ',
    '    🦀         ',
    '     🦀        ',
    '      🦀       ',
  ];
  const crab = frames[frame % frames.length];

  // Glitchy waiting text
  const glitchFrames = ['WAITING', 'WA1T1NG', 'WAITING', 'W4ITING', 'WAITING', 'WAI71NG'];
  const glitchText = glitchFrames[frame % glitchFrames.length];

  return (
    <Box flexDirection="column" padding={2} alignItems="center">
      <Box marginBottom={1}>
        <Text>{crab}</Text>
      </Box>
      <Text bold color={COLORS.accent}>◇ {glitchText} FOR SESSIONS ◇</Text>
      <Box marginTop={1}>
        <Text dimColor>sessions appear when Claude Code connects</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>run </Text>
        <Text bold color={COLORS.working}>csm install-hooks</Text>
        <Text dimColor> for setup</Text>
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════
// ▓▓▓ MAIN DASHBOARD ▓▓▓
// ═══════════════════════════════════════════════════════════════

function flattenTree(
  sessions: ClaudeSession[],
  expandedIds: Set<string>,
  showCompleted: boolean,
  parentId?: string
): ClaudeSession[] {
  let roots = parentId
    ? sessions.filter(s => s.parentId === parentId)
    : sessions.filter(s => !s.parentId);

  if (!showCompleted) {
    roots = roots.filter(s => s.status !== 'completed');
  }

  const result: ClaudeSession[] = [];
  for (const session of roots) {
    result.push(session);
    if (expandedIds.has(session.id)) {
      const children = flattenTree(sessions, expandedIds, showCompleted, session.id);
      result.push(...children);
    }
  }
  return result;
}

export function Dashboard({ viewMode = 'list', serverPort }: DashboardProps) {
  const { exit } = useApp();
  const [sessions, setSessions] = useState<ClaudeSession[]>(sessionStore.sorted());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<ViewMode>(viewMode);
  const [showDetail, setShowDetail] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    return new Set(sessionStore.all().map(s => s.id));
  });
  const [showCompleted, setShowCompleted] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [knownIds, setKnownIds] = useState<Set<string>>(() => {
    return new Set(sessionStore.all().map(s => s.id));
  });

  useEffect(() => {
    const unsubscribe = sessionStore.subscribe(() => {
      const currentSessions = sessionStore.sorted();
      setSessions(currentSessions);

      setKnownIds(prevKnown => {
        const newIds = new Set(prevKnown);
        for (const s of currentSessions) {
          if (!prevKnown.has(s.id)) {
            setExpandedIds(prev => new Set([...prev, s.id]));
          }
          newIds.add(s.id);
        }
        return newIds;
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const cleanup = () => {
      const cleaned = sessionStore.cleanupStaleSessions();
      if (cleaned > 0) {
        setSessions(sessionStore.sorted());
      }
    };
    const interval = setInterval(cleanup, 30000);
    return () => clearInterval(interval);
  }, []);

  const flattenedSessions = flattenTree(sessions, expandedIds, showCompleted);
  const alertCount = sessions.filter(s => s.alerting).length;

  useEffect(() => {
    if (selectedIndex >= flattenedSessions.length) {
      setSelectedIndex(Math.max(0, flattenedSessions.length - 1));
    }
  }, [flattenedSessions.length, selectedIndex]);

  const selectedSession = flattenedSessions[selectedIndex];

  const toggleExpand = (sessionId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  useInput((input, key) => {
    if (showDetail) return;

    if (input === 'q') exit();
    if (input === 'r') setSessions(sessionStore.sorted());
    if (input === 'l' || input === 'L') setView('list');
    if (input === 'k' || input === 'K') setView('kanban');
    if (input === 'c' || input === 'C') setShowCompleted(prev => !prev);
    if (key.upArrow) setSelectedIndex(i => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIndex(i => Math.min(flattenedSessions.length - 1, i + 1));

    if (input === 'o' && selectedSession) {
      sendAction(selectedSession.id, 'focus');
    }

    if (input === 'd' && selectedSession) {
      sessionStore.upsert(selectedSession.id, {
        status: 'completed',
        alerting: false,
        attentionType: null,
      });
    }

    if (input === 'D') {
      const cleaned = sessionStore.cleanupStaleSessions();
      setSessions(sessionStore.sorted());
      setStatusMessage(cleaned > 0 ? `cleaned ${cleaned} stale session(s)` : 'no stale sessions');
      setTimeout(() => setStatusMessage(null), 3000);
    }

    if (input === 'P') {
      const pruned = sessionStore.pruneStale(30);
      setSessions(sessionStore.sorted());
      setStatusMessage(pruned > 0 ? `removed ${pruned} old session(s)` : 'no old sessions');
      setTimeout(() => setStatusMessage(null), 3000);
    }

    if (key.return && selectedSession) {
      const hasChildren = sessionStore.getChildren(selectedSession.id).length > 0;
      if (hasChildren && input !== ' ') {
        toggleExpand(selectedSession.id);
      } else {
        setShowDetail(true);
      }
    }

    if (input === ' ' && selectedSession) {
      setShowDetail(true);
    }

    if (key.leftArrow && selectedSession) {
      setExpandedIds(prev => {
        const next = new Set(prev);
        next.delete(selectedSession.id);
        return next;
      });
    }
    if (key.rightArrow && selectedSession) {
      setExpandedIds(prev => {
        const next = new Set(prev);
        next.add(selectedSession.id);
        return next;
      });
    }
  });

  if (showDetail && selectedSession) {
    return (
      <Box flexDirection="column">
        <Header serverPort={serverPort} view={view} showCompleted={showCompleted} alertCount={alertCount} />
        <DetailView session={selectedSession} onClose={() => setShowDetail(false)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header serverPort={serverPort} view={view} showCompleted={showCompleted} alertCount={alertCount} />

      {sessions.length === 0 ? (
        <EmptyState />
      ) : view === 'kanban' ? (
        <KanbanView sessions={sessions} selectedIndex={selectedIndex} showCompleted={showCompleted} />
      ) : (
        <ListView
          sessions={sessions}
          selectedIndex={selectedIndex}
          expandedIds={expandedIds}
          flattenedSessions={flattenedSessions}
          showCompleted={showCompleted}
        />
      )}

      {statusMessage && (
        <Box paddingX={1}>
          <Text color={COLORS.working}>{SYMBOLS.bullet} {statusMessage}</Text>
        </Box>
      )}

      <StatusBar sessions={sessions} />
    </Box>
  );
}
