import { describe, expect, test } from 'bun:test';
import { formatAge, oneLine, tildify } from '../src/theme';

describe('formatAge', () => {
  test('seconds under a minute', () => {
    expect(formatAge(0)).toBe('0s');
    expect(formatAge(59_000)).toBe('59s');
  });
  test('minutes under an hour', () => {
    expect(formatAge(60_000)).toBe('1m');
    expect(formatAge(59 * 60_000)).toBe('59m');
  });
  test('hours under a day', () => {
    expect(formatAge(90 * 60_000)).toBe('1h');
    expect(formatAge(23 * 3_600_000)).toBe('23h');
  });
  test('days', () => {
    expect(formatAge(47 * 3_600_000)).toBe('1d');
    expect(formatAge(3 * 86_400_000)).toBe('3d');
  });
  test('negative clamps to 0s', () => {
    expect(formatAge(-5000)).toBe('0s');
  });
});

describe('oneLine', () => {
  test('squashes whitespace and newlines', () => {
    expect(oneLine('a\n  b\t c')).toBe('a b c');
  });
  test('ellipsizes past max', () => {
    const out = oneLine('x'.repeat(100), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('tildify', () => {
  test('abbreviates home prefix', () => {
    expect(tildify('/Users/a/b', '/Users/a')).toBe('~/b');
  });
  test('leaves other paths alone', () => {
    expect(tildify('/tmp/x', '/Users/a')).toBe('/tmp/x');
  });
});
