import { describe, expect, test } from 'bun:test';
import { CastStore, deriveRow, groupLabel, sortSessions, buildSessions } from '../src/model';
import type { SessionInfo, TranscriptDetail } from '../src/types';

function info(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    pid: 1,
    sessionId: 'sid-1',
    name: 'Test',
    cwd: '/Users/x/proj',
    status: 'idle',
    startedAt: 0,
    updatedAt: 1000,
    kind: 'interactive',
    ...over,
  };
}

function detail(over: Partial<TranscriptDetail> = {}): TranscriptDetail {
  return { tail: [], pending: null, todos: null, subagents: [], customTitle: null, ...over };
}

describe('deriveRow', () => {
  test('alert outranks busy (permission prompt mid-turn)', () => {
    expect(deriveRow(info({ status: 'busy' }), 5000, null)).toBe('needs_you');
  });
  test('pending tool while busy is just execution', () => {
    const d = detail({ pending: { tool: 'Bash', summary: 'sleep 60', since: 1 } });
    expect(deriveRow(info({ status: 'busy' }), null, d)).toBe('busy');
  });
  test('pending tool while idle means waiting on you', () => {
    const d = detail({ pending: { tool: 'Edit', summary: 'x.md', since: 1 } });
    expect(deriveRow(info({ status: 'idle' }), null, d)).toBe('needs_you');
  });
  test('subagent needs_you bubbles to parent', () => {
    const d = detail({
      subagents: [{ agentId: 'a', label: 'x', status: 'needs_you', updatedAt: 1 }],
    });
    expect(deriveRow(info(), null, d)).toBe('needs_you');
  });
  test('plain busy / idle', () => {
    expect(deriveRow(info({ status: 'busy' }), null, null)).toBe('busy');
    expect(deriveRow(info(), null, null)).toBe('idle');
  });
});

describe('groupLabel', () => {
  test('basename, upper, separators to underscore', () => {
    expect(groupLabel('/Users/x/BioBrain_Rebuild')).toBe('BIOBRAIN_REBUILD');
    expect(groupLabel('/Users/x/Coco Scientific')).toBe('COCO_SCIENTIFIC');
    expect(groupLabel('/Users/x/angelica-parente-site')).toBe('ANGELICA_PARENTE_SITE');
  });
});

describe('sortSessions', () => {
  const a = info({ pid: 1, sessionId: 'a', cwd: '/p/one', updatedAt: 100 });
  const b = info({ pid: 2, sessionId: 'b', cwd: '/p/one', status: 'busy', updatedAt: 200 });
  const c = info({ pid: 3, sessionId: 'c', cwd: '/p/two', updatedAt: 300 });
  const d = info({ pid: 4, sessionId: 'd', cwd: '/p/two', updatedAt: 50 });

  test('needs-you band sorted longest-wait first; groups by recency; busy before idle', () => {
    const alerts = new Map([
      ['c', 500],
      ['d', 100], // waiting longer
    ]);
    const grouped = sortSessions(buildSessions([a, b, c, d], alerts, new Map(), new Map()));
    expect(grouped.needsYou.map((s) => s.info.sessionId)).toEqual(['d', 'c']);
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]!.sessions.map((s) => s.info.sessionId)).toEqual(['b', 'a']);
    expect(grouped.counts).toEqual({ needsYou: 2, busy: 1, idle: 1, total: 4 });
  });

  test('groups ordered by most recent activity', () => {
    const grouped = sortSessions(buildSessions([a, b, c, d], new Map(), new Map(), new Map()));
    expect(grouped.groups.map((g) => g.dir)).toEqual(['/p/two', '/p/one']);
    expect(grouped.groups[0]!.label).toBe('TWO');
  });
});

describe('CastStore alert lifecycle', () => {
  function makeStore(detailResult: TranscriptDetail | null = null) {
    return new CastStore({
      readSessions: () => [info()],
      readDetail: () => detailResult,
      now: () => 10_000,
    });
  }

  test('Notification hook sets alert; other hook clears it', () => {
    const store = makeStore();
    store.refreshSessions();
    store.applyEvent({ kind: 'hook', hook: 'Notification', sessionId: 'sid-1', cwd: '/Users/x/proj', workspace: ''  });
    expect(store.snapshot().needsYou).toHaveLength(1);
    store.applyEvent({ kind: 'hook', hook: 'PostToolUse', sessionId: 'sid-1', cwd: '/Users/x/proj', workspace: ''  });
    expect(store.snapshot().needsYou).toHaveLength(0);
  });

  test('alert self-heals when transcript shows later activity and nothing pending', () => {
    const healed = detail({ tail: [{ role: 'assistant', text: 'done', ts: 20_000 }] });
    const store = makeStore(healed);
    store.refreshSessions();
    store.applyEvent({ kind: 'hook', hook: 'Notification', sessionId: 'sid-1', cwd: '/Users/x/proj', workspace: ''  });
    // applyEvent already refreshed detail; activity ts 20000 > alert 10000, no pending
    expect(store.snapshot().needsYou).toHaveLength(0);
  });

  test('status event maps pid→workspace and notification seeding uses it', () => {
    const store = makeStore();
    store.refreshSessions();
    store.applyEvent({ kind: 'status', pid: 1, workspace: 'WS-1', running: false });
    store.seedNotifications([
      { workspace: 'WS-1', title: 'Test', body: 'Claude needs your permission', at: 9000, read: false },
      { workspace: 'WS-1', title: 'Test', body: 'Claude is waiting for your input', at: 8000, read: true },
    ]);
    const snap = store.snapshot();
    expect(snap.needsYou).toHaveLength(1);
    expect(snap.needsYou[0]!.alertSince).toBe(9000);
    expect(snap.needsYou[0]!.surface).toEqual({ workspace: 'WS-1' });
  });

  test('hook event carries workspace and seedWorkspaces fills gaps', () => {
    const store = makeStore();
    store.refreshSessions();
    store.applyEvent({
      kind: 'hook', hook: 'PostToolUse', sessionId: 'sid-1', cwd: '/Users/x/proj', workspace: 'WS-HOOK',
    });
    expect(store.snapshot().groups[0]!.sessions[0]!.surface).toEqual({ workspace: 'WS-HOOK' });
    expect(store.unmappedPids()).toEqual([]);
  });
});
