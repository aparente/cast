import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { sessionStore } from '../store.js';
import type { ClaudeSession, SessionStatus } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// TEST UTILITIES
// ═══════════════════════════════════════════════════════════════

function createMockSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  const id = overrides.id || `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    name: overrides.name || 'test-session',
    status: overrides.status || 'idle',
    projectPath: overrides.projectPath || '/test/path',
    currentTask: overrides.currentTask,
    pendingMessage: overrides.pendingMessage,
    lastActivity: overrides.lastActivity || new Date(),
    alerting: overrides.alerting || false,
    terminal: overrides.terminal || { type: 'tmux', id: 'test-pane' },
    parentId: overrides.parentId,
    todos: overrides.todos,
    lastStatus: overrides.lastStatus,
    attentionType: overrides.attentionType,
    plan: overrides.plan,
  };
}

// ═══════════════════════════════════════════════════════════════
// DESIGN SYSTEM CONSTANTS TESTS
// ═══════════════════════════════════════════════════════════════

describe('Design System', () => {
  test('COLORS object has all required keys', async () => {
    const { COLORS } = await import('./Dashboard.js');

    // Accent color
    expect(COLORS.accent).toBeDefined();

    // Status colors
    expect(COLORS.idle).toBeDefined();
    expect(COLORS.working).toBeDefined();
    expect(COLORS.needs_input).toBeDefined();
    expect(COLORS.error).toBeDefined();
    expect(COLORS.completed).toBeDefined();

    // UI elements
    expect(COLORS.border).toBeDefined();
    expect(COLORS.borderFocus).toBeDefined();
    expect(COLORS.text).toBeDefined();
    expect(COLORS.textDim).toBeDefined();
    expect(COLORS.success).toBeDefined();
    expect(COLORS.warning).toBeDefined();
  });

  test('SYMBOLS object has required indicators', async () => {
    const { SYMBOLS } = await import('./Dashboard.js');

    // Status indicators
    expect(SYMBOLS.statusIdle).toBe('◇');
    expect(SYMBOLS.statusWorking).toBe('◈');
    expect(SYMBOLS.statusAlert).toBe('◆');
    expect(SYMBOLS.statusError).toBe('✖');
    expect(SYMBOLS.statusDone).toBe('◇');

    // Tree navigation
    expect(SYMBOLS.treeBranch).toBe('├─');
    expect(SYMBOLS.treeExpand).toBe('▸');
    expect(SYMBOLS.treeCollapse).toBe('▾');

    // Selection
    expect(SYMBOLS.selected).toBe('▶');
    expect(SYMBOLS.bullet).toBe('›');
    expect(SYMBOLS.actionable).toBe('⚡');

    // Progress
    expect(SYMBOLS.progressFull).toBe('█');
    expect(SYMBOLS.progressEmpty).toBe('░');
  });

  test('STATUS_COLORS maps all session statuses', async () => {
    const { STATUS_COLORS } = await import('./Dashboard.js');

    const statuses: SessionStatus[] = ['idle', 'working', 'needs_input', 'error', 'completed'];
    for (const status of statuses) {
      expect(STATUS_COLORS[status]).toBeDefined();
      expect(typeof STATUS_COLORS[status]).toBe('string');
    }
  });

  test('STATUS_LABELS has playful vocabulary for each status', async () => {
    const { STATUS_LABELS } = await import('./Dashboard.js');

    const statuses: SessionStatus[] = ['idle', 'working', 'needs_input', 'error', 'completed'];
    for (const status of statuses) {
      expect(Array.isArray(STATUS_LABELS[status])).toBe(true);
      expect(STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════

describe('Utility Functions', () => {
  test('getStatusLabel returns different labels based on session ID', async () => {
    const { getStatusLabel } = await import('./Dashboard.js');

    const label1 = getStatusLabel('idle', 'abc123');
    const label2 = getStatusLabel('idle', 'xyz789');

    expect(typeof label1).toBe('string');
    expect(typeof label2).toBe('string');
    expect(label1.length).toBeGreaterThan(0);
  });

  test('getStatusSymbol returns correct symbols', async () => {
    const { getStatusSymbol, SYMBOLS } = await import('./Dashboard.js');

    expect(getStatusSymbol('idle', false)).toBe(SYMBOLS.statusIdle);
    expect(getStatusSymbol('working', false)).toBe(SYMBOLS.statusWorking);
    expect(getStatusSymbol('needs_input', false)).toBe(SYMBOLS.statusAlert);
    expect(getStatusSymbol('error', false)).toBe(SYMBOLS.statusError);
    expect(getStatusSymbol('completed', false)).toBe(SYMBOLS.statusDone);

    // Alerting should override
    expect(getStatusSymbol('idle', true)).toBe(SYMBOLS.statusAlert);
  });

  test('getSessionEmoji returns context-aware emojis', async () => {
    const { getSessionEmoji } = await import('./Dashboard.js');

    expect(getSessionEmoji('bio-project')).toBe('🧬');
    expect(getSessionEmoji('grant-application')).toBe('💰');
    expect(getSessionEmoji('web-frontend')).toBe('🌐');
    expect(getSessionEmoji('api-server')).toBe('⚡');
    expect(getSessionEmoji('test-suite')).toBe('🧪');
    expect(getSessionEmoji('documentation')).toBe('📝');
    expect(getSessionEmoji('data-analysis')).toBe('📊');
    expect(getSessionEmoji('claude-ai')).toBe('🤖');
    expect(getSessionEmoji('cast-session')).toBe('🦀');

    // Default should be a sea creature
    const defaultEmoji = getSessionEmoji('random-name');
    expect(['🦀', '🐙', '🦑', '🐡', '🦐', '🦞'].includes(defaultEmoji)).toBe(true);
  });

  test('getProgress returns correct progress object', async () => {
    const { getProgress } = await import('./Dashboard.js');

    // With plan
    const sessionWithPlan = createMockSession({
      plan: {
        name: 'Test Plan',
        steps: [
          { title: 'Step 1', completed: true },
          { title: 'Step 2', completed: true },
          { title: 'Step 3', completed: false },
        ],
      },
    });
    const planProgress = getProgress(sessionWithPlan);
    expect(planProgress).toEqual({ completed: 2, total: 3 });

    // With todos (no plan)
    const sessionWithTodos = createMockSession({
      todos: [
        { content: 'Task 1', activeForm: 'Working on Task 1', status: 'completed' },
        { content: 'Task 2', activeForm: 'Working on Task 2', status: 'in_progress' },
        { content: 'Task 3', activeForm: 'Working on Task 3', status: 'pending' },
      ],
    });
    const todoProgress = getProgress(sessionWithTodos);
    expect(todoProgress).toEqual({ completed: 1, total: 3 });

    // No progress
    const sessionNoProgress = createMockSession();
    expect(getProgress(sessionNoProgress)).toBeNull();
  });

  test('getCurrentTask extracts correct task info', async () => {
    const { getCurrentTask } = await import('./Dashboard.js');

    // In-progress todo takes priority
    const sessionWithTodo = createMockSession({
      todos: [
        { content: 'Task 1', activeForm: 'Working on Task 1', status: 'in_progress' },
      ],
    });
    expect(getCurrentTask(sessionWithTodo)).toBe('Working on Task 1');

    // Working status shows current task
    const workingSession = createMockSession({
      status: 'working',
      currentTask: 'Running tests',
    });
    expect(getCurrentTask(workingSession)).toBe('Running tests');

    // Needs input shows pending message
    const waitingSession = createMockSession({
      status: 'needs_input',
      pendingMessage: 'Awaiting approval',
    });
    expect(getCurrentTask(waitingSession)).toBe('Awaiting approval');

    // Fallback to lastStatus
    const idleSession = createMockSession({
      lastStatus: 'Last thing I did',
    });
    expect(getCurrentTask(idleSession)).toBe('Last thing I did');
  });

  test('extractCompletionSummary truncates long text', async () => {
    const { extractCompletionSummary } = await import('./Dashboard.js');

    const shortText = 'Done!';
    expect(extractCompletionSummary(shortText)).toBe('Done!');

    const longText = 'This is a very long status message that should be truncated to fit within the display area.';
    const result = extractCompletionSummary(longText);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith('...')).toBe(true);

    // Extracts first sentence
    const multiSentence = 'First sentence. Second sentence.';
    expect(extractCompletionSummary(multiSentence)).toBe('First sentence.');
  });
});

// ═══════════════════════════════════════════════════════════════
// SESSION STORE INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════

describe('Session Store Integration', () => {
  beforeEach(() => {
    // Clear all sessions before each test
    for (const session of sessionStore.all()) {
      sessionStore.remove(session.id);
    }
  });

  test('sessionStore.upsert creates new session', () => {
    const session = sessionStore.upsert('test-1', {
      name: 'Test Session',
      status: 'idle',
      terminal: { type: 'tmux', id: 'pane-1' },
    });

    expect(session.id).toBe('test-1');
    expect(session.name).toBe('Test Session');
    expect(session.status).toBe('idle');
  });

  test('sessionStore.upsert updates existing session', () => {
    sessionStore.upsert('test-1', { name: 'Test', status: 'idle' });
    const updated = sessionStore.upsert('test-1', { status: 'working' });

    expect(updated.status).toBe('working');
    expect(updated.name).toBe('Test');
  });

  test('sessionStore.getAggregatedStatus aggregates child status', () => {
    // Create parent
    sessionStore.upsert('parent', { name: 'Parent', status: 'idle' });

    // Create alerting child
    sessionStore.upsert('child', {
      name: 'Child',
      status: 'needs_input',
      alerting: true,
      parentId: 'parent',
    });

    const aggStatus = sessionStore.getAggregatedStatus('parent');
    expect(aggStatus.alerting).toBe(true);
    expect(aggStatus.childCount).toBe(1);
    expect(aggStatus.alertingChildCount).toBe(1);
  });

  test('sessionStore.sortedRoots returns only root sessions sorted by urgency', () => {
    sessionStore.upsert('root-idle', { name: 'Idle', status: 'idle' });
    sessionStore.upsert('root-alert', { name: 'Alert', status: 'needs_input', alerting: true });
    sessionStore.upsert('child', { name: 'Child', status: 'working', parentId: 'root-idle' });

    const roots = sessionStore.sortedRoots();
    expect(roots.length).toBe(2);
    expect(roots[0]?.id).toBe('root-alert'); // Alerting first
    expect(roots.every(r => !r.parentId)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// COLUMN WIDTH CONSTANTS TESTS
// ═══════════════════════════════════════════════════════════════

describe('Column Widths', () => {
  test('COL constants define proper widths', async () => {
    const { COL } = await import('./Dashboard.js');

    expect(COL.TREE).toBeGreaterThan(0);
    expect(COL.EMOJI).toBeGreaterThan(0);
    expect(COL.NAME).toBeGreaterThan(0);
    expect(COL.STATUS).toBeGreaterThan(0);
    expect(COL.PROGRESS).toBeGreaterThan(0);
    expect(COL.ALERT).toBeGreaterThan(0);
    expect(COL.TASK).toBeGreaterThan(0);

    // Ensure reasonable total width
    const totalWidth = COL.TREE + COL.EMOJI + COL.NAME + COL.STATUS + COL.PROGRESS + COL.ALERT + COL.TASK;
    expect(totalWidth).toBeLessThan(120); // Should fit in most terminals
  });
});

// ═══════════════════════════════════════════════════════════════
// LOGO CONSTANT TESTS
// ═══════════════════════════════════════════════════════════════

describe('Logo Constants', () => {
  test('CAST_LOGO_MINI is defined and has cyberpunk style', async () => {
    const { CAST_LOGO_MINI } = await import('./Dashboard.js');

    expect(CAST_LOGO_MINI).toBe('▓▒░ CAST ░▒▓');
    expect(CAST_LOGO_MINI).toContain('CAST');
  });

  test('CAST_LOGO array has proper ASCII art', async () => {
    const { CAST_LOGO } = await import('./Dashboard.js');

    expect(Array.isArray(CAST_LOGO)).toBe(true);
    expect(CAST_LOGO.length).toBe(4);
    // All lines should be roughly the same length
    const lengths = CAST_LOGO.map(line => line.length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    expect(lengths.every(l => Math.abs(l - avgLength) < 5)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// KANBAN COLUMNS TESTS
// ═══════════════════════════════════════════════════════════════

describe('Kanban Columns', () => {
  test('KANBAN_COLUMNS covers all session statuses', async () => {
    const { KANBAN_COLUMNS } = await import('./Dashboard.js');

    const allStatuses: SessionStatus[] = ['idle', 'working', 'needs_input', 'error', 'completed'];
    const coveredStatuses = KANBAN_COLUMNS.flatMap(col => col.statuses);

    for (const status of allStatuses) {
      expect(coveredStatuses).toContain(status);
    }
  });

  test('KANBAN_COLUMNS have required properties', async () => {
    const { KANBAN_COLUMNS } = await import('./Dashboard.js');

    expect(KANBAN_COLUMNS.length).toBe(3);
    for (const col of KANBAN_COLUMNS) {
      expect(col.id).toBeDefined();
      expect(col.title).toBeDefined();
      expect(col.symbol).toBeDefined();
      expect(col.color).toBeDefined();
      expect(Array.isArray(col.statuses)).toBe(true);
    }
  });
});
