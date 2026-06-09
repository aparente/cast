import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  isNeedsYou,
  parseEventLine,
  parseNotificationLine,
  parseSetStatusArgs,
} from '../src/sources/cmux';

const eventLines = (await Bun.file(join(import.meta.dir, 'fixtures/cmux-events.ndjson')).text())
  .split('\n')
  .filter((l) => l.trim());

describe('parseEventLine', () => {
  test('ack line → null', () => {
    expect(parseEventLine(eventLines[0]!)).toBeNull();
  });
  test('Notification hook (phase received) → hook event, claude- prefix stripped', () => {
    const e = parseEventLine(eventLines[1]!);
    expect(e).toEqual({
      kind: 'hook',
      hook: 'Notification',
      sessionId: 'a3822ccd-b073-40db-afd9-971f1060b749',
      cwd: '/Users/sublux/Obsidian_Vaults/BioBrain_Rebuild',
    });
  });
  test('phase completed → other (not double-counted)', () => {
    expect(parseEventLine(eventLines[2]!)).toEqual({ kind: 'other' });
  });
  test('set_status → pid/tab/panel/running mapping', () => {
    const e = parseEventLine(eventLines[3]!);
    expect(e).toEqual({
      kind: 'status',
      pid: 54662,
      tab: '854619E0-3379-4851-B860-78A7219F83E9',
      panel: '2E42A95B-32FC-4074-95C2-41BE0AA6754F',
      running: true,
    });
  });
  test('notification.clear_requested → notif_clear', () => {
    expect(parseEventLine(eventLines[4]!)).toEqual({ kind: 'notif_clear' });
  });
  test('unrelated event → other; junk → null', () => {
    expect(parseEventLine(eventLines[5]!)).toEqual({ kind: 'other' });
    expect(parseEventLine('garbage')).toBeNull();
  });
});

describe('parseSetStatusArgs', () => {
  test('Idle state → running false', () => {
    const p = parseSetStatusArgs('claude_code Idle --tab=AAAA-BBBB --pid=99');
    expect(p).toEqual({ pid: 99, tab: 'AAAA-BBBB', panel: null, running: false });
  });
  test('non-claude status → null', () => {
    expect(parseSetStatusArgs('other_thing Running --tab=X --pid=1')).toBeNull();
  });
});

describe('parseNotificationLine', () => {
  const line =
    '1:0E479110-9886-439A-A3BF-A5DC005BB429|7156AB25-F449-4795-82B7-0EF2A4D9555C|D0921E7F-F68F-4A45-84FE-4711D6B4A56B|unread|Claude Code|Permission|Claude needs your permission|2026-06-09T01:03:10Z|pct:Biobrain';

  test('parses tab, read state, body, time', () => {
    const n = parseNotificationLine(line)!;
    expect(n.tab).toBe('D0921E7F-F68F-4A45-84FE-4711D6B4A56B');
    expect(n.read).toBe(false);
    expect(n.body).toBe('Claude needs your permission');
    expect(n.at).toBe(Date.parse('2026-06-09T01:03:10Z'));
    expect(isNeedsYou(n)).toBe(true);
  });
  test('waiting-for-input body is needs-you; others are not', () => {
    const waiting = parseNotificationLine(
      '0:A|B|C|read|T|Claude Code|Claude is waiting for your input|2026-06-09T20:52:21Z|ws',
    )!;
    expect(isNeedsYou(waiting)).toBe(true);
    const other = parseNotificationLine('0:A|B|C|read|T|S|Build finished|2026-06-09T20:52:21Z|ws')!;
    expect(isNeedsYou(other)).toBe(false);
  });
  test('junk → null', () => {
    expect(parseNotificationLine('No notifications')).toBeNull();
    expect(parseNotificationLine('1:a|b')).toBeNull();
  });
});
