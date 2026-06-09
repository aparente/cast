import { describe, expect, test } from 'bun:test';
import { approve, message, screenShowsPrompt, type ActionDeps } from '../src/actions';
import type { Session } from '../src/types';

const session = (surface: boolean): Session => ({
  info: {
    pid: 1, sessionId: 's', name: null, cwd: '/x', status: 'idle',
    startedAt: 0, updatedAt: 0, kind: 'interactive',
  },
  row: 'needs_you',
  alertSince: 1,
  detail: null,
  surface: surface ? { workspace: 'WS' } : null,
});

function deps(screen: string | null): ActionDeps & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    readScreen: async () => screen,
    send: async (_s, text) => (sent.push(`text:${text}`), { ok: true }),
    sendKey: async (_s, key) => (sent.push(`key:${key}`), { ok: true }),
    focusTab: async () => ({ ok: true }),
  };
}

describe('screenShowsPrompt', () => {
  test('matches real permission dialog phrasings', () => {
    expect(screenShowsPrompt('Do you want to proceed?\n❯ 1. Yes\n  2. No')).toBe(true);
    expect(screenShowsPrompt('Allow Bash to run rm -rf?')).toBe(true);
    expect(screenShowsPrompt('Claude is waiting for your input')).toBe(true);
  });
  test('rejects ordinary working screens', () => {
    expect(screenShowsPrompt('✻ Cooking… (esc to interrupt)')).toBe(false);
    expect(screenShowsPrompt('$ ls\nfile.txt')).toBe(false);
  });
});

describe('approve', () => {
  test('refuses when no prompt is visible — never blind keystrokes', async () => {
    const d = deps('✻ Cooking…');
    const r = await approve(session(true), d);
    expect(r.ok).toBe(false);
    expect(d.sent).toEqual([]);
  });
  test('sends y when a prompt is visible', async () => {
    const d = deps('Do you want to proceed? ❯ 1. Yes');
    const r = await approve(session(true), d);
    expect(r.ok).toBe(true);
    expect(d.sent).toEqual(['key:y']);
  });
  test('refuses on unreadable screen', async () => {
    const r = await approve(session(true), deps(null));
    expect(r.ok).toBe(false);
  });
});

describe('message', () => {
  test('view-only session refuses', async () => {
    const r = await message(session(false), 'hi', deps(''));
    expect(r).toEqual({ ok: false, reason: 'view-only · not in cmux' });
  });
  test('empty message refuses; real message sends', async () => {
    const d = deps('');
    expect((await message(session(true), '   ', d)).ok).toBe(false);
    expect((await message(session(true), 'run the tests', d)).ok).toBe(true);
    expect(d.sent).toEqual(['text:run the tests']);
  });
});
