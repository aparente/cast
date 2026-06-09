import { describe, expect, test } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { SessionList, flatten } from '../src/ui/SessionList';
import { DetailOverlay } from '../src/ui/DetailOverlay';
import { sortSessions, buildSessions } from '../src/model';
import type { SessionInfo, TranscriptDetail } from '../src/types';

const NOW = 1_000_000_000;

function info(over: Partial<SessionInfo>): SessionInfo {
  return {
    pid: 1, sessionId: 's1', name: 'Test', cwd: '/p/biobrain', status: 'idle',
    startedAt: 0, updatedAt: NOW - 60_000, kind: 'interactive', ...over,
  };
}

const pendingDetail: TranscriptDetail = {
  tail: [
    { role: 'user', text: 'retag the notes', ts: NOW - 700_000 },
    { role: 'assistant', text: 'Working on it.', ts: NOW - 650_000 },
  ],
  pending: { tool: 'Bash', summary: 'rm -rf node_modules && bun install', since: NOW - 720_000 },
  todos: { done: 4, total: 7, current: 'regenerate charts' },
  subagents: [
    { agentId: 'a1', label: 'verify 40 tagged notes', status: 'running', updatedAt: NOW - 120_000 },
  ],
  customTitle: null,
};

function makeGrouped() {
  const a = info({ pid: 1, sessionId: 'alert-1', name: 'ARIA Proposals SCENT', status: 'idle' });
  const b = info({ pid: 2, sessionId: 'busy-1', name: 'Gene-Linking', status: 'busy', cwd: '/p/biobrain' });
  const c = info({ pid: 3, sessionId: 'idle-1', name: 'Site Build', cwd: '/p/site' });
  const sessions = buildSessions(
    [a, b, c],
    new Map([['alert-1', NOW - 720_000]]),
    new Map([
      ['alert-1', pendingDetail],
      ['busy-1', { ...pendingDetail, pending: null, subagents: pendingDetail.subagents }],
    ]),
    new Map([[1, { surface: 'S1', tab: 'T1' }]]),
  );
  return sortSessions(sessions);
}

describe('SessionList', () => {
  const grouped = makeGrouped();
  const { items, nav } = flatten(grouped, true);

  test('needs-you band renders before groups, with pending summary', () => {
    const { lastFrame } = render(
      <SessionList
        grouped={grouped} items={items} nav={nav} selected={0}
        frame={0} width={110} height={30} now={NOW} filter={null}
      />,
    );
    const out = lastFrame()!;
    expect(out).toContain('1 need you · 1 busy · 1 idle · 3 sessions');
    expect(out.indexOf('NEEDS YOU')).toBeLessThan(out.indexOf('BIOBRAIN'));
    expect(out).toContain('◐');
    expect(out).toContain('ARIA Proposals SCENT');
    expect(out).toContain('Bash · rm -rf node_modules && bun install');
    expect(out).toContain('SITE · 1');
  });

  test('subagent micro-row renders under its parent', () => {
    const { lastFrame } = render(
      <SessionList
        grouped={grouped} items={items} nav={nav} selected={0}
        frame={0} width={110} height={30} now={NOW} filter={null}
      />,
    );
    expect(lastFrame()).toContain('└ ● verify 40 tagged notes');
  });

  test('subagents hidden when toggled off', () => {
    const flat = flatten(grouped, false);
    const { lastFrame } = render(
      <SessionList
        grouped={grouped} items={flat.items} nav={flat.nav} selected={0}
        frame={0} width={110} height={30} now={NOW} filter={null}
      />,
    );
    expect(lastFrame()).not.toContain('verify 40 tagged notes');
  });

  test('nav order matches display order: alerts first', () => {
    expect(nav.map((s) => s.info.sessionId)).toEqual(['alert-1', 'busy-1', 'idle-1']);
  });
});

describe('DetailOverlay', () => {
  const grouped = makeGrouped();
  const alertSession = grouped.needsYou[0]!;

  test('renders pending strip, tail, todos, composer hint', () => {
    const { lastFrame } = render(
      <DetailOverlay
        session={alertSession} composerFocus={false} draft="" onDraft={() => {}}
        onSubmit={() => {}} width={100} height={30} now={NOW}
      />,
    );
    const out = lastFrame()!;
    expect(out).toContain('◐ PENDING');
    expect(out).toContain('[y] approve · [n] deny');
    expect(out).toContain('me› retag the notes');
    expect(out).toContain('cl› Working on it.');
    expect(out).toContain('todos 4/7 · regenerate charts');
    expect(out).toContain('m to message');
  });

  test('view-only session says so instead of composer', () => {
    const viewOnly = { ...alertSession, surface: null };
    const { lastFrame } = render(
      <DetailOverlay
        session={viewOnly} composerFocus={false} draft="" onDraft={() => {}}
        onSubmit={() => {}} width={100} height={30} now={NOW}
      />,
    );
    expect(lastFrame()).toContain('view-only · not in cmux');
  });
});
