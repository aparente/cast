import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSessionFile, readSessions, readStale } from '../src/sources/sessions';

const fixture = await Bun.file(join(import.meta.dir, 'fixtures/session-12000.json')).text();

describe('parseSessionFile', () => {
  test('parses a real session file', () => {
    const s = parseSessionFile(fixture)!;
    expect(s.pid).toBe(12000);
    expect(s.sessionId).toBe('43b9c113-a74b-46bb-aee4-d770f7cea033');
    expect(s.name).toBe('BioHub 2026');
    expect(s.cwd).toBe('/Users/sublux/Obsidian_Vaults/BioBrain_Rebuild');
    expect(s.status).toBe('idle');
    expect(s.kind).toBe('interactive');
    expect(s.updatedAt).toBe(1780865666310);
  });
  test('junk JSON → null', () => {
    expect(parseSessionFile('{nope')).toBeNull();
    expect(parseSessionFile('"a string"')).toBeNull();
  });
  test('missing required fields → null', () => {
    expect(parseSessionFile('{"pid":1}')).toBeNull();
  });
  test('missing name → null name, unknown status → idle', () => {
    const s = parseSessionFile(
      '{"pid":2,"sessionId":"x","cwd":"/tmp","status":"weird"}',
    )!;
    expect(s.name).toBeNull();
    expect(s.status).toBe('idle');
  });
  test('busy status preserved', () => {
    const s = parseSessionFile('{"pid":2,"sessionId":"x","cwd":"/tmp","status":"busy"}')!;
    expect(s.status).toBe('busy');
  });
});

describe('readSessions / readStale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-test-'));
  writeFileSync(join(dir, '12000.json'), fixture);
  writeFileSync(join(dir, 'junk.json'), 'not json');

  test('live filter excludes dead pids; stale includes them', () => {
    expect(readSessions(dir, () => false)).toHaveLength(0);
    expect(readStale(dir, () => false)).toHaveLength(1);
    expect(readSessions(dir, () => true)).toHaveLength(1);
  });
  test('missing dir → empty, no throw', () => {
    expect(readSessions('/nonexistent/dir')).toEqual([]);
  });
});
