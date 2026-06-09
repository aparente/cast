// Adapter for Claude Code transcript JSONL files under ~/.claude/projects.
// All transcript schema knowledge lives here. Parsing is pure (lines in,
// TranscriptDetail out); readDetail is the thin fs wrapper.

import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PendingRequest, Subagent, Todos, TranscriptDetail, Turn } from '../types';
import { oneLine } from '../theme';

export const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/** Observed convention: every /, _, ., and space in cwd becomes '-'. */
export function mungeCwd(cwd: string): string {
  return cwd.replace(/[/_. ]/g, '-');
}

export function transcriptPath(cwd: string, sessionId: string): string {
  return join(PROJECTS_DIR, mungeCwd(cwd), `${sessionId}.jsonl`);
}

const TAIL_ENTRIES = 24;

/** One-line summary of a tool invocation for rows and pending strips. */
function toolSummary(name: string, input: any): string {
  if (name === 'Bash' && typeof input?.command === 'string') return oneLine(input.command);
  const fp = input?.file_path ?? input?.path ?? input?.notebook_path;
  if (typeof fp === 'string') return oneLine(fp.split('/').pop() ?? fp);
  if (typeof input?.description === 'string') return oneLine(input.description);
  if (typeof input?.prompt === 'string') return oneLine(input.prompt);
  try {
    return oneLine(JSON.stringify(input ?? {}), 60);
  } catch {
    return '';
  }
}

/** Parse already-split transcript lines (chronological order). */
export function parseTranscript(lines: string[]): TranscriptDetail {
  const tail: Turn[] = [];
  let customTitle: string | null = null;
  let todos: Todos | null = null;
  // tool_use id → invocation; deleted when its tool_result arrives
  const open = new Map<string, { tool: string; summary: string; ts: number }>();
  const tasks = new Map<string, Subagent>();

  for (const line of lines) {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d?.isSidechain) continue; // subagent traffic mirrored into the parent file
    const ts = typeof d?.timestamp === 'string' ? Date.parse(d.timestamp) || 0 : 0;

    if (d?.type === 'custom-title' && typeof d.customTitle === 'string') {
      customTitle = d.customTitle;
      continue;
    }

    if (d?.type === 'assistant') {
      const content = d.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          tail.push({ role: 'assistant', text: oneLine(block.text, 200), ts });
        } else if (block?.type === 'tool_use') {
          const summary = toolSummary(block.name, block.input);
          tail.push({ role: 'tool', text: `${block.name} · ${summary}`, ts });
          if (block.name === 'TodoWrite') {
            const items = Array.isArray(block.input?.todos) ? block.input.todos : [];
            const current = items.find((t: any) => t?.status === 'in_progress');
            todos = {
              done: items.filter((t: any) => t?.status === 'completed').length,
              total: items.length,
              current: current ? oneLine(String(current.activeForm ?? current.content ?? ''), 60) : null,
            };
          } else if (block.name === 'Task' || block.name === 'Agent') {
            tasks.set(block.id, {
              agentId: block.id,
              label: oneLine(String(block.input?.description ?? 'subagent'), 48),
              status: 'running',
              updatedAt: ts,
            });
            continue; // a running Task is not a permission request
          }
          open.set(block.id, { tool: block.name, summary, ts });
        }
      }
    } else if (d?.type === 'user') {
      const content = d.message?.content;
      if (typeof content === 'string') {
        if (content.trim()) tail.push({ role: 'user', text: oneLine(content, 200), ts });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            tail.push({ role: 'user', text: oneLine(block.text, 200), ts });
          } else if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            open.delete(block.tool_use_id);
            const task = tasks.get(block.tool_use_id);
            if (task) tasks.set(block.tool_use_id, { ...task, status: 'done', updatedAt: ts });
          }
        }
      }
    }
  }

  let pending: PendingRequest | null = null;
  for (const { tool, summary, ts } of open.values()) {
    if (!pending || ts > pending.since) pending = { tool, summary, since: ts };
  }

  return {
    tail: tail.slice(-TAIL_ENTRIES),
    pending,
    todos,
    subagents: [...tasks.values()],
    customTitle,
  };
}

const TAIL_BYTES = 256 * 1024;

/** Read the last ~256KB of a transcript and parse it. Null if unreadable. */
export function readDetail(cwd: string, sessionId: string): TranscriptDetail | null {
  const path = transcriptPath(cwd, sessionId);
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    let lines = buf.toString('utf8').split('\n');
    if (start > 0) lines = lines.slice(1); // drop partial first line
    return parseTranscript(lines.filter((l) => l.trim()));
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
