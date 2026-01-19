import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { sessionStore } from '../store.js';
import { DEFAULT_PORT } from '../server.js';
import type { ClaudeSession, ViewMode, SessionStatus, QuickActionType, AggregatedStatus, AttentionType } from '../types.js';
import { canSendInput } from '../types.js';

// ─────────────────────────────────────────────────────────────
// HYPERLINK SUPPORT (OSC8)
// ─────────────────────────────────────────────────────────────

/**
 * Get the editor command from environment
 */
function getEditorCommand(): string {
  const editor = process.env.EDITOR || '';
  if (editor.includes('cursor')) return 'cursor';
  if (editor.includes('code') || editor.includes('Code')) return 'code';
  // Fallback chain
  return 'cursor';
}

/**
 * Build a URL that opens the path in the editor
 */
function buildEditorUrl(path: string): string {
  const editor = getEditorCommand();
  if (editor === 'code') return `vscode://file${path}`;
  if (editor === 'cursor') return `cursor://file${path}`;
  return `file://${path}`;
}

/**
 * OSC8 hyperlink component - makes text clickable in supporting terminals
 */
function Hyperlink({ url, children }: { url: string; children: React.ReactNode }) {
  // OSC 8 format: \x1b]8;;URL\x07TEXT\x1b]8;;\x07
  const start = `\x1b]8;;${url}\x07`;
  const end = `\x1b]8;;\x07`;
  return <Text>{start}{children}{end}</Text>;
}

interface DashboardProps {
  viewMode?: ViewMode;
  serverPort?: number;
}

// Playful status vocabulary
const STATUS_VERBS: Record<SessionStatus, string[]> = {
  idle: ['Chilling', 'Lounging', 'Daydreaming', 'Napping', 'Pondering'],
  working: ['Cooking', 'Scheming', 'Tinkering', 'Brewing', 'Crafting'],
  needs_input: ['Waiting', 'Stuck!', 'Your turn', 'Paging you', '👀'],
  error: ['Confused', 'Lost', 'Oops', 'Halp'],
  completed: ['Done!', 'Nailed it', 'Victory', '✓'],
};

function getSessionEmoji(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('bio') || lower.includes('lab') || lower.includes('health')) return '🧬';
  if (lower.includes('grant') || lower.includes('money') || lower.includes('finance')) return '💰';
  if (lower.includes('web') || lower.includes('site') || lower.includes('frontend')) return '🌐';
  if (lower.includes('api') || lower.includes('server') || lower.includes('backend')) return '⚡';
  if (lower.includes('test') || lower.includes('spec')) return '🧪';
  if (lower.includes('doc') || lower.includes('readme')) return '📝';
  if (lower.includes('data') || lower.includes('scrape')) return '📊';
  if (lower.includes('ai') || lower.includes('ml') || lower.includes('claude')) return '🤖';
  const creatures = ['🦀', '🐙', '🦑', '🐡', '🦐', '🦞'] as const;
  return creatures[name.length % creatures.length] ?? '🦀';
}

function getStatusVerb(status: SessionStatus, sessionId: string): string {
  const verbs = STATUS_VERBS[status];
  const index = sessionId.charCodeAt(0) % verbs.length;
  return verbs[index] ?? verbs[0] ?? status;
}

const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: 'gray',
  working: 'blue',
  needs_input: 'yellow',
  error: 'red',
  completed: 'green',
};

function getActionStatusColor(status: string): string {
  if (status.includes('✓')) return 'green';
  if (status.includes('✗')) return 'red';
  return 'yellow';
}

/**
 * Get progress string from todos or plan (e.g., "2/5")
 * Prioritizes plan progress if available
 */
function getProgress(session: ClaudeSession): string {
  // If session has a plan with steps, show plan progress
  if (session.plan && session.plan.steps.length > 0) {
    const completed = session.plan.steps.filter(s => s.completed).length;
    const total = session.plan.steps.length;
    return `${completed}/${total}`;
  }

  // Fall back to todo progress
  if (!session.todos || session.todos.length === 0) return '';
  const completed = session.todos.filter(t => t.status === 'completed').length;
  const total = session.todos.length;
  return `${completed}/${total}`;
}

/**
 * Get the current plan step name
 */
function getCurrentPlanStep(session: ClaudeSession): string | null {
  if (!session.plan || session.plan.steps.length === 0) return null;

  // If currentStep is set, use it
  if (session.plan.currentStep !== undefined) {
    const step = session.plan.steps[session.plan.currentStep];
    if (step) return step.title;
  }

  // Otherwise find first incomplete step
  const incompleteStep = session.plan.steps.find(s => !s.completed);
  return incompleteStep?.title ?? null;
}

/**
 * Extract a completion summary from Claude's last message
 * Parses first sentence or action phrase to show what was completed
 */
function extractCompletionSummary(lastStatus: string): string {
  // Remove markdown formatting
  let text = lastStatus.replace(/[*_`#]/g, '').trim();

  // Get first sentence (up to period, question mark, or exclamation)
  const sentenceMatch = text.match(/^([^.!?]+[.!?]?)/);
  if (sentenceMatch?.[1]) {
    text = sentenceMatch[1].trim();
  }

  // Truncate if still too long (keep it concise for list view)
  if (text.length > 40) {
    text = text.slice(0, 37) + '...';
  }

  return text;
}

/**
 * Get the current task description (activeForm of in_progress todo)
 * Falls back to lastStatus (what Claude last said) when idle
 * Shows completion context when waiting for input
 */
function getCurrentTask(session: ClaudeSession): string {
  // First, check for in-progress todo
  if (session.todos) {
    const inProgress = session.todos.find(t => t.status === 'in_progress');
    if (inProgress) return inProgress.activeForm;
  }

  // If working, show current tool use
  if (session.status === 'working' && session.currentTask) {
    return session.currentTask;
  }

  // If waiting for input, show completion context with "waiting" suffix
  if (session.status === 'needs_input') {
    if (session.lastStatus) {
      const summary = extractCompletionSummary(session.lastStatus);
      return `${summary}, waiting…`;
    }
    return session.pendingMessage || 'Waiting for input…';
  }

  // If idle, show last message from transcript (what Claude said)
  if (session.lastStatus) {
    return session.lastStatus;
  }

  return session.currentTask || '';
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

// ─────────────────────────────────────────────────────────────
// DETAIL VIEW (with quick actions)
// ─────────────────────────────────────────────────────────────

function DetailView({ session, onClose }: { session: ClaudeSession; onClose: () => void }) {
  const [responding, setResponding] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const emoji = getSessionEmoji(session.name);
  const canAct = canSendInput(session);

  const handleAction = async (action: QuickActionType, text?: string) => {
    setActionStatus('Sending...');
    const success = await sendAction(session.id, action, text);
    if (success) {
      setActionStatus('✓ Sent!');
      if (action !== 'focus') {
        setTimeout(onClose, 500);
      } else {
        setTimeout(() => setActionStatus(null), 1500);
      }
    } else {
      setActionStatus('✗ Failed');
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
    // Jump to terminal
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
    <Box flexDirection="column" borderStyle="double" borderColor="cyan" padding={1}>
      {/* Header with clickable path */}
      <Box marginBottom={1}>
        <Text bold color="cyan">{emoji} {session.name}</Text>
        <Text dimColor> — </Text>
        {session.projectPath ? (
          <Hyperlink url={buildEditorUrl(session.projectPath)}>
            <Text dimColor underline>{session.projectPath}</Text>
          </Hyperlink>
        ) : (
          <Text dimColor>—</Text>
        )}
      </Box>

      {/* Status */}
      <Box marginBottom={1}>
        <Text>Status: </Text>
        <Text color={STATUS_COLORS[session.status]} bold>
          {session.status === 'working' ? <><Spinner type="dots" /> </> : null}
          {getStatusVerb(session.status, session.id)}
        </Text>
        {session.attentionType === 'critical' && (
          <Text color="magenta" bold> (permission required)</Text>
        )}
      </Box>

      {/* Terminal Info with jump hint */}
      <Box marginBottom={1}>
        <Text dimColor>Terminal: </Text>
        <Text color={canAct ? 'green' : 'gray'}>
          {session.terminal.type}
          {session.terminal.id ? ` (${session.terminal.id})` : ''}
        </Text>
        <Text dimColor> — </Text>
        <Text color="cyan">[o] jump</Text>
        {canAct && <Text color="green"> ✓ actions</Text>}
      </Box>

      {/* Plan Context */}
      {session.plan && (
        <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="blue" padding={1}>
          <Box>
            <Text bold color="blue">📋 Plan: </Text>
            <Text>{session.plan.name}</Text>
            {session.plan.steps.length > 0 && (
              <Text dimColor> ({session.plan.steps.filter(s => s.completed).length}/{session.plan.steps.length})</Text>
            )}
          </Box>
          {getCurrentPlanStep(session) && (
            <Box marginTop={1}>
              <Text dimColor>Current step: </Text>
              <Text color="cyan">{getCurrentPlanStep(session)}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Last Claude Message - context for what led to input request */}
      {session.lastStatus && session.alerting && (
        <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="cyan" padding={1}>
          <Text bold color="cyan">Claude said:</Text>
          <Text dimColor>{session.lastStatus.slice(0, 200)}{session.lastStatus.length > 200 ? '...' : ''}</Text>
        </Box>
      )}

      {/* Pending Message */}
      {session.pendingMessage && (
        <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="yellow" padding={1}>
          <Text bold color="yellow">Waiting for input:</Text>
          <Text>{session.pendingMessage}</Text>
        </Box>
      )}

      {/* Quick Actions */}
      {canAct && session.alerting && !responding && (
        <Box marginTop={1}>
          <Text bold>Quick Actions: </Text>
          <Text color="green">[y] Approve </Text>
          <Text color="red">[n] Deny </Text>
          <Text color="blue">[r] Respond </Text>
        </Box>
      )}

      {/* Response Input */}
      {responding && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="blue">Type response (Enter to send, Esc to cancel):</Text>
          <Box borderStyle="single" borderColor="blue" paddingX={1}>
            <TextInput
              value={responseText}
              onChange={setResponseText}
              placeholder="Your response..."
            />
          </Box>
        </Box>
      )}

      {/* Action Status */}
      {actionStatus && (
        <Box marginTop={1}>
          <Text color={getActionStatusColor(actionStatus)}>
            {actionStatus}
          </Text>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>[Esc] Back to list</Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────
// LIST VIEW WITH TREE SUPPORT
// ─────────────────────────────────────────────────────────────

interface SessionRowProps {
  session: ClaudeSession;
  selected: boolean;
  depth?: number;           // Indentation level for tree
  hasChildren?: boolean;    // Does this session have subagents?
  expanded?: boolean;       // Is the tree expanded?
  aggregatedStatus?: AggregatedStatus;  // For status bubbling
}

// Fixed column widths for alignment (using ASCII only for reliable width)
const COL_TREE = 6;      // Tree prefix (selection + indent + icon)
const COL_EMOJI = 2;     // Emoji (separate to avoid width issues)
const COL_NAME = 18;     // Session name including child count
const COL_VIBE = 10;     // Status verb (playful)
const COL_PROGRESS = 5;  // Task progress (e.g., "2/5")
const COL_ALERT = 2;     // Alert indicator (padded)
const COL_TASK = 25;     // Current task (truncated)

function SessionRow({ session, selected, depth = 0, hasChildren = false, expanded = true, aggregatedStatus }: SessionRowProps) {
  const aggStatus = aggregatedStatus || sessionStore.getAggregatedStatus(session.id);
  const displayStatus = aggStatus.alerting ? aggStatus.status : session.status;
  const color = STATUS_COLORS[displayStatus];
  const emoji = getSessionEmoji(session.name);
  const statusVerb = getStatusVerb(displayStatus, session.id);
  const canAct = canSendInput(session);
  const progress = getProgress(session);
  const currentTask = getCurrentTask(session);

  // Tree prefix using ASCII only: selection + indent + expand icon
  const treeChar = hasChildren ? (expanded ? 'v' : '>') : (depth > 0 ? '-' : ' ');
  const selChar = selected ? '>' : ' ';
  const indent = '  '.repeat(Math.min(depth, 2)); // Max 2 levels of indent
  const treeCol = `${selChar}${indent}${treeChar}`.padEnd(COL_TREE);

  // Build name with optional child count
  const childBadge = hasChildren ? `(${aggStatus.childCount})` : '';
  const availableNameLen = COL_NAME - childBadge.length - 1;
  const truncatedName = session.name.slice(0, availableNameLen);
  const nameCol = `${truncatedName} ${childBadge}`.padEnd(COL_NAME);

  // Alert indicator (ASCII)
  // * = session is alerting:
  //   - magenta: critical (permission request)
  //   - green: casual + actionable (tmux)
  //   - yellow: casual + view-only (non-tmux)
  // ! = child session is alerting
  let alertChar = ' ';
  let alertColor: string | undefined;
  if (session.alerting) {
    alertChar = '*';
    if (session.attentionType === 'critical') {
      alertColor = 'magenta';  // Critical: permission/approval needed
    } else {
      alertColor = canAct ? 'green' : 'yellow';  // Casual: green if actionable
    }
  } else if (aggStatus.alertingChildCount > 0) {
    alertChar = '!';
    alertColor = 'yellow';
  }

  return (
    <Box flexDirection="row" paddingX={1}>
      {/* Tree column */}
      <Box width={COL_TREE}>
        <Text color={selected ? 'cyan' : undefined} bold={selected}>{treeCol}</Text>
      </Box>

      {/* Emoji column - fixed 2 chars */}
      <Box width={COL_EMOJI}>
        <Text>{emoji}</Text>
      </Box>

      {/* Name column */}
      <Box width={COL_NAME}>
        <Text color={aggStatus.alerting ? 'yellow' : undefined} bold={aggStatus.alerting}>
          {nameCol}
        </Text>
      </Box>

      <Text color="gray">│</Text>

      {/* Vibe column (playful status) */}
      <Box width={COL_VIBE}>
        {displayStatus === 'working' ? (
          <Text color={color}>
            <Spinner type="dots" /> {statusVerb.slice(0, COL_VIBE - 2)}
          </Text>
        ) : (
          <Text color={color}>{statusVerb.padEnd(COL_VIBE)}</Text>
        )}
      </Box>

      <Text color="gray">│</Text>

      {/* Progress column */}
      <Box width={COL_PROGRESS}>
        <Text color={progress ? 'cyan' : 'gray'}>{progress.padEnd(COL_PROGRESS) || '—'.padEnd(COL_PROGRESS)}</Text>
      </Box>

      <Text color="gray">│</Text>

      {/* Alert column */}
      <Box width={COL_ALERT}>
        <Text color={alertColor} bold={alertChar !== ' '}>
          {alertChar.padEnd(COL_ALERT)}
        </Text>
      </Box>

      <Text color="gray">│</Text>

      {/* Task column - shows current activity from TodoWrite */}
      <Box width={COL_TASK}>
        <Text dimColor>{currentTask.slice(0, COL_TASK) || '—'}</Text>
      </Box>
    </Box>
  );
}

/**
 * Recursive tree view component for sessions with subagents
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

  // Filter out completed children if toggle is off
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
  // Filter out completed root sessions if toggle is off
  if (!showCompleted) {
    rootSessions = rootSessions.filter(s => s.status !== 'completed');
  }
  const selectedSession = flattenedSessions[selectedIndex];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Box paddingX={1} borderBottom borderColor="gray">
        <Box width={COL_TREE}><Text bold>{''}</Text></Box>
        <Box width={COL_EMOJI}><Text bold>{''}</Text></Box>
        <Box width={COL_NAME}><Text bold>{'Session'.padEnd(COL_NAME)}</Text></Box>
        <Text color="gray">│</Text>
        <Box width={COL_VIBE}><Text bold>{'Vibe'.padEnd(COL_VIBE)}</Text></Box>
        <Text color="gray">│</Text>
        <Box width={COL_PROGRESS}><Text bold>{'Prog'.padEnd(COL_PROGRESS)}</Text></Box>
        <Text color="gray">│</Text>
        <Box width={COL_ALERT}><Text bold>{'!'.padEnd(COL_ALERT)}</Text></Box>
        <Text color="gray">│</Text>
        <Box width={COL_TASK}><Text bold>{'Task'.padEnd(COL_TASK)}</Text></Box>
      </Box>
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

// ─────────────────────────────────────────────────────────────
// KANBAN VIEW
// ─────────────────────────────────────────────────────────────

interface KanbanColumnDef {
  id: string;
  title: string;
  emoji: string;
  color: string;
  statuses: SessionStatus[];
}

const KANBAN_COLUMNS: KanbanColumnDef[] = [
  { id: 'attention', title: 'Needs You', emoji: '👋', color: 'yellow', statuses: ['needs_input', 'error'] },
  { id: 'working', title: 'Busy', emoji: '⚡', color: 'blue', statuses: ['working'] },
  { id: 'idle', title: 'Chilling', emoji: '😴', color: 'gray', statuses: ['idle', 'completed'] },
];

function KanbanCard({ session, selected, isSubagent }: { session: ClaudeSession; selected: boolean; isSubagent: boolean }) {
  const emoji = getSessionEmoji(session.name);
  const borderColor = selected ? 'cyan' : (session.alerting ? 'yellow' : 'gray');
  const canAct = canSendInput(session);

  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? 'double' : 'round'}
      borderColor={borderColor}
      paddingX={1}
      marginBottom={1}
      marginLeft={isSubagent ? 2 : 0}
    >
      {/* Subagent indicator */}
      {isSubagent && (
        <Text dimColor>↳ subtask</Text>
      )}
      <Box>
        <Text bold={selected || session.alerting} color={session.alerting ? 'yellow' : undefined}>
          {emoji} {session.name.slice(0, 16)}
        </Text>
        {canAct && session.alerting && <Text color="green"> ⚡</Text>}
      </Box>
      {session.status === 'working' ? (
        <Text color="blue" dimColor>
          <Spinner type="dots" /> {getStatusVerb(session.status, session.id)}
        </Text>
      ) : (
        <Text dimColor>{getStatusVerb(session.status, session.id)}</Text>
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

  // Filter out completed subagents if toggle is off
  if (!showCompleted) {
    columnSessions = columnSessions.filter(s => {
      // Always show root sessions
      if (!s.parentId) return true;
      // Hide completed subagents
      return s.status !== 'completed';
    });
  }

  const rootCount = columnSessions.filter(s => !s.parentId).length;
  const subagentCount = columnSessions.filter(s => s.parentId).length;

  return (
    <Box flexDirection="column" width="33%" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={column.color}>
          {column.emoji} {column.title}
          <Text dimColor> ({rootCount}{subagentCount > 0 ? `+${subagentCount}` : ''})</Text>
        </Text>
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
    <Box borderStyle="round" borderColor="gray" padding={1}>
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

// ─────────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────

function Header({ serverPort, view, showCompleted }: { serverPort?: number; view: ViewMode; showCompleted: boolean }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 2000);
    return () => clearInterval(interval);
  }, []);

  const titleColors = ['cyan', 'cyanBright', 'cyan'] as const;
  const titleColor = titleColors[tick % titleColors.length];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="round" borderColor={titleColor} paddingX={2}>
        <Text bold color={titleColor}>🦀 Cast</Text>
        {serverPort && <Text dimColor> (:{serverPort})</Text>}
        <Text>  </Text>
        <Text color={view === 'list' ? 'cyan' : 'gray'} bold={view === 'list'}>[l]ist</Text>
        <Text> </Text>
        <Text color={view === 'kanban' ? 'cyan' : 'gray'} bold={view === 'kanban'}>[k]anban</Text>
        <Text>  </Text>
        <Text color={showCompleted ? 'green' : 'gray'} bold={showCompleted}>[c]ompleted {showCompleted ? '✓' : '○'}</Text>
      </Box>
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          ↑/↓ nav • Enter detail • o jump • d done • D cleanup • P prune • c completed • l/k view • q quit
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>Alert: </Text>
        <Text color="magenta">*</Text><Text dimColor>=permission </Text>
        <Text color="green">*</Text><Text dimColor>=actionable </Text>
        <Text color="yellow">*</Text><Text dimColor>=view-only </Text>
        <Text dimColor>│ In detail: </Text>
        <Text color="green">y</Text><Text dimColor>/</Text>
        <Text color="red">n</Text><Text dimColor>/</Text>
        <Text color="blue">r</Text>
      </Box>
    </Box>
  );
}

function StatusBar({ sessions }: { sessions: ClaudeSession[] }) {
  const rootSessions = sessions.filter(s => !s.parentId);
  const subagents = sessions.filter(s => s.parentId);
  const activeSubagents = subagents.filter(s => s.status !== 'completed');
  const completedSubagents = subagents.filter(s => s.status === 'completed');

  const alerting = sessions.filter(s => s.alerting).length;
  const working = sessions.filter(s => s.status === 'working').length;
  const actionable = sessions.filter(s => s.alerting && canSendInput(s)).length;

  let vibe = '';
  if (alerting > 0) {
    vibe = alerting === 1 ? ' — Someone needs you!' : ` — ${alerting} friends need you!`;
  } else if (working > 0) {
    vibe = working === 1 ? ' — One busy bee' : ` — ${working} busy bees`;
  } else if (sessions.length > 0) {
    vibe = ' — All quiet on the western front';
  }

  // Count working root sessions
  const workingRoots = rootSessions.filter(s => s.status === 'working').length;

  return (
    <Box marginTop={1} paddingX={1}>
      <Text>
        <Text color="cyan">{rootSessions.length}</Text> session{rootSessions.length !== 1 ? 's' : ''}
        {workingRoots > 0 && (
          <Text color="yellow"> ({workingRoots} working)</Text>
        )}
        {subagents.length > 0 && (
          <Text dimColor>
            {' • '}<Text color="blue">{activeSubagents.length}</Text> active
            {completedSubagents.length > 0 && <Text> / <Text color="gray">{completedSubagents.length}</Text> done</Text>}
            {' subtask'}{subagents.length !== 1 ? 's' : ''}
          </Text>
        )}
        {actionable > 0 && <Text color="green"> • {actionable} ⚡actionable</Text>}
        <Text dimColor>{vibe}</Text>
      </Text>
    </Box>
  );
}

function EmptyState() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setFrame(f => f + 1), 200);
    return () => clearInterval(interval);
  }, []);

  const crabFrames = ['🦀    ', ' 🦀   ', '  🦀  ', '   🦀 ', '    🦀', '   🦀 ', '  🦀  ', ' 🦀   '];
  const crab = crabFrames[frame % crabFrames.length];

  return (
    <Box flexDirection="column" padding={2} alignItems="center">
      <Text>{crab}</Text>
      <Text color="gray" bold>No active sessions</Text>
      <Box marginTop={1}>
        <Text dimColor>Sessions will appear when Claude Code connects.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Run <Text color="cyan">csm install-hooks</Text> for setup.
        </Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────

/**
 * Flatten tree structure into navigable list (respecting expanded state and filters)
 */
function flattenTree(
  sessions: ClaudeSession[],
  expandedIds: Set<string>,
  showCompleted: boolean,
  parentId?: string
): ClaudeSession[] {
  let roots = parentId
    ? sessions.filter(s => s.parentId === parentId)
    : sessions.filter(s => !s.parentId);

  // Filter out completed sessions if toggle is off
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
  // Track which sessions are expanded (show children)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Start with all sessions expanded
    return new Set(sessionStore.all().map(s => s.id));
  });
  // Toggle to show/hide completed subagents (hidden by default)
  const [showCompleted, setShowCompleted] = useState(false);
  // Status message for user feedback (auto-clears after 3s)
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Track known session IDs to detect truly new sessions
  const [knownIds, setKnownIds] = useState<Set<string>>(() => {
    return new Set(sessionStore.all().map(s => s.id));
  });

  useEffect(() => {
    const unsubscribe = sessionStore.subscribe(() => {
      const currentSessions = sessionStore.sorted();
      setSessions(currentSessions);

      // Only auto-expand truly NEW sessions (not seen before)
      setKnownIds(prevKnown => {
        const newIds = new Set(prevKnown);
        for (const s of currentSessions) {
          if (!prevKnown.has(s.id)) {
            // This is a new session - auto-expand it
            setExpandedIds(prev => new Set([...prev, s.id]));
          }
          newIds.add(s.id);
        }
        return newIds;
      });
    });
    return unsubscribe;
  }, []);

  // Periodic cleanup of stale sessions (every 30 seconds)
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

  // Compute flattened list for navigation (roots + visible children)
  const flattenedSessions = flattenTree(sessions, expandedIds, showCompleted);

  useEffect(() => {
    if (selectedIndex >= flattenedSessions.length) {
      setSelectedIndex(Math.max(0, flattenedSessions.length - 1));
    }
  }, [flattenedSessions.length, selectedIndex]);

  const selectedSession = flattenedSessions[selectedIndex];

  // Toggle expand/collapse for a session
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
    if (showDetail) return; // Detail view handles its own input

    if (input === 'q') exit();
    if (input === 'r') setSessions(sessionStore.sorted());
    if (input === 'l') setView('list');
    if (input === 'k') setView('kanban');
    if (input === 'c') setShowCompleted(prev => !prev);  // Toggle completed subagents
    if (key.upArrow) setSelectedIndex(i => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIndex(i => Math.min(flattenedSessions.length - 1, i + 1));

    // 'o' - Jump to terminal
    if (input === 'o' && selectedSession) {
      sendAction(selectedSession.id, 'focus');
    }

    // 'd' - Mark selected session as completed (remove from active view)
    if (input === 'd' && selectedSession) {
      sessionStore.upsert(selectedSession.id, {
        status: 'completed',
        alerting: false,
        attentionType: null,
      });
    }

    // 'D' - Clean all stale sessions
    if (input === 'D') {
      const cleaned = sessionStore.cleanupStaleSessions();
      setSessions(sessionStore.sorted());
      setStatusMessage(cleaned > 0 ? `Cleaned ${cleaned} stale session(s)` : 'No stale sessions found');
      setTimeout(() => setStatusMessage(null), 3000);
    }

    // 'P' - Prune (remove) sessions older than 30 minutes
    if (input === 'P') {
      const pruned = sessionStore.pruneStale(30);
      setSessions(sessionStore.sorted());
      setStatusMessage(pruned > 0 ? `Removed ${pruned} old session(s)` : 'No old sessions to remove');
      setTimeout(() => setStatusMessage(null), 3000);
    }

    // Enter: toggle expand if has children, or show detail
    if (key.return && selectedSession) {
      const hasChildren = sessionStore.getChildren(selectedSession.id).length > 0;
      if (hasChildren && input !== ' ') {
        toggleExpand(selectedSession.id);
      } else {
        setShowDetail(true);
      }
    }

    // Space: always show detail view
    if (input === ' ' && selectedSession) {
      setShowDetail(true);
    }

    // Left/Right: collapse/expand tree
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

  // Detail view overlay
  if (showDetail && selectedSession) {
    return (
      <Box flexDirection="column">
        <Header serverPort={serverPort} view={view} showCompleted={showCompleted} />
        <DetailView session={selectedSession} onClose={() => setShowDetail(false)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header serverPort={serverPort} view={view} showCompleted={showCompleted} />

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
          <Text color="cyan">{statusMessage}</Text>
        </Box>
      )}

      <StatusBar sessions={sessions} />
    </Box>
  );
}
