import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mungeCwd, parseTranscript } from '../src/sources/transcripts';

const lines = (await Bun.file(join(import.meta.dir, 'fixtures/transcript-basic.jsonl')).text())
  .split('\n')
  .filter((l) => l.trim());

describe('mungeCwd', () => {
  test('slashes, underscores, dots, spaces → dashes', () => {
    expect(mungeCwd('/Users/sublux/github_repositories')).toBe('-Users-sublux-github-repositories');
    expect(mungeCwd('/Users/sublux/.claude')).toBe('-Users-sublux--claude');
    expect(mungeCwd('/Users/sublux/Documents/Coco Scientific')).toBe(
      '-Users-sublux-Documents-Coco-Scientific',
    );
  });
});

describe('parseTranscript', () => {
  const d = parseTranscript(lines);

  test('latest custom-title wins', () => {
    expect(d.customTitle).toBe('Reagent Verification');
  });

  test('tail has user, assistant, and tool turns in order; skips sidechain + junk', () => {
    const roles = d.tail.map((t) => t.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'tool', 'tool', 'tool']);
    expect(d.tail[0].text).toContain('retag the regen-med notes');
    expect(d.tail[2].text).toBe("Bash · grep -c 'regen-med' notes/**/*.md");
    expect(d.tail.some((t) => t.text.includes('sidechain'))).toBe(false);
  });

  test('resolved tool_use is not pending; trailing unresolved Edit is', () => {
    expect(d.pending).not.toBeNull();
    expect(d.pending!.tool).toBe('Edit');
    expect(d.pending!.summary).toBe('validation.md');
  });

  test('running Task is a subagent, not a pending request', () => {
    expect(d.subagents).toHaveLength(1);
    expect(d.subagents[0].label).toBe('verify 40 tagged notes');
    expect(d.subagents[0].status).toBe('running');
    expect(d.pending!.tool).not.toBe('Task');
  });

  test('todos from latest TodoWrite', () => {
    expect(d.todos).toEqual({ done: 1, total: 3, current: 'Regenerating charts' });
  });

  test('tool_result resolves a Task to done', () => {
    const resolved = parseTranscript([
      ...lines,
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_3', content: 'done' }] },
        timestamp: '2026-06-09T10:05:00.000Z',
      }),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_4', content: 'ok' }] },
        timestamp: '2026-06-09T10:05:01.000Z',
      }),
    ]);
    expect(resolved.subagents[0].status).toBe('done');
    expect(resolved.pending).toBeNull();
  });

  test('empty input → empty detail', () => {
    const e = parseTranscript([]);
    expect(e.tail).toEqual([]);
    expect(e.pending).toBeNull();
    expect(e.todos).toBeNull();
  });
});
