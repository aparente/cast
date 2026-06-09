import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  isNeedsYou,
  parseEventLine,
  parseNotificationLine,
  parseSetStatusArgs,
  parseTopWorkspaces,
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
      workspace: '7156AB25-F449-4795-82B7-0EF2A4D9555C',
    });
  });
  test('phase completed → other (not double-counted)', () => {
    expect(parseEventLine(eventLines[2]!)).toEqual({ kind: 'other' });
  });
  test('set_status → pid/workspace/running mapping (--tab is the workspace id)', () => {
    const e = parseEventLine(eventLines[3]!);
    expect(e).toEqual({
      kind: 'status',
      pid: 54662,
      workspace: '854619E0-3379-4851-B860-78A7219F83E9',
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
  test('Idle state → running false; --tab maps to workspace', () => {
    const p = parseSetStatusArgs('claude_code Idle --tab=AAAA-BBBB --pid=99');
    expect(p).toEqual({ pid: 99, workspace: 'AAAA-BBBB', running: false });
  });
  test('non-claude status → null', () => {
    expect(parseSetStatusArgs('other_thing Running --tab=X --pid=1')).toBeNull();
  });
});

describe('parseNotificationLine', () => {
  const line =
    '1:0E479110-9886-439A-A3BF-A5DC005BB429|7156AB25-F449-4795-82B7-0EF2A4D9555C|D0921E7F-F68F-4A45-84FE-4711D6B4A56B|unread|Claude Code|Permission|Claude needs your permission|2026-06-09T01:03:10Z|pct:Biobrain';

  test('parses workspace (2nd field), read state, body, time', () => {
    const n = parseNotificationLine(line)!;
    expect(n.workspace).toBe('7156AB25-F449-4795-82B7-0EF2A4D9555C');
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

describe('parseTopWorkspaces', () => {
  // Columns: cpu mem count type id parent name (tab-separated). A process row
  // hangs under a tag/pane whose chain leads to a workspace:<n> ref.
  const tsv = [
    '2.6\t12\t17\tworkspace\tworkspace:9\twindow:1\tcast-scratch',
    '2.6\t12\t16\ttag\tworkspace:UUID:tag:claude_code\tworkspace:9\tNeeds input',
    '2.3\t25\t1\tprocess\t98603\tworkspace:UUID:tag:claude_code\t2.1.170',
    '2.6\t12\t17\tpane\tpane:12\tworkspace:9\t',
    '0.0\t3\t1\tprocess\t99255\t98603\tbun',
  ].join('\n');

  test('resolves each pid up to its workspace ref', () => {
    const map = parseTopWorkspaces(tsv);
    expect(map.get(98603)).toBe('workspace:9');
    expect(map.get(99255)).toBe('workspace:9'); // via parent process 98603 → tag → workspace
  });
  test('garbage tolerated', () => {
    expect(parseTopWorkspaces('nonsense\nrows').size).toBe(0);
  });
});
