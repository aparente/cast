// One session = one line. Subagents = indented micro-rows.
// Ink only where there's data: idle context is dim, blank stays blank.

import React from 'react';
import { Box, Text } from 'ink';
import type { Session, Subagent } from '../types';
import { CORAL, CYAN_DIM, GLYPH, SPINNER, formatAge, oneLine } from '../theme';

export function contextFor(s: Session): string {
  if (s.row === 'needs_you' && s.detail?.pending) {
    return `${s.detail.pending.tool} · ${s.detail.pending.summary}`;
  }
  const last = s.detail?.tail.at(-1);
  if (s.row === 'busy') {
    if (s.detail?.todos?.current) return s.detail.todos.current;
    return last ? last.text : '';
  }
  return last ? last.text : '';
}

export function SessionRow({
  session: s,
  selected,
  frame,
  width,
  now,
}: {
  session: Session;
  selected: boolean;
  frame: number;
  width: number;
  now: number;
}) {
  const needsYou = s.row === 'needs_you';
  const stale = s.row === 'stale';
  const name = s.info.name ?? s.info.sessionId.slice(0, 8);
  const nameW = 24;
  const spinner = s.row === 'busy' ? SPINNER[frame % SPINNER.length] : ' ';
  const age = formatAge(now - (needsYou && s.alertSince ? s.alertSince : s.info.updatedAt));
  const ctxW = Math.max(0, width - (2 + nameW + 2 + 1 + 1 + 4 + 2));
  const ctx = ctxW > 8 ? oneLine(contextFor(s), ctxW) : '';
  const viewOnly = !s.surface?.surface;

  const nameColor = needsYou ? CORAL : stale ? 'gray' : undefined;

  return (
    <Box>
      <Text color={needsYou ? CORAL : stale ? 'gray' : undefined}>{GLYPH[s.row]} </Text>
      <Text color={nameColor} dimColor={stale} inverse={selected} bold={needsYou}>
        {oneLine(name, nameW).padEnd(nameW)}
      </Text>
      <Text color={CYAN_DIM}>{spinner}</Text>
      <Text dimColor> {age.padStart(4)}</Text>
      <Text
        color={needsYou ? CORAL : undefined}
        dimColor={!needsYou}
      >
        {ctx ? `  ${ctx}` : ''}
      </Text>
      {viewOnly && ctxW > 24 ? <Text dimColor> ·view-only</Text> : null}
    </Box>
  );
}

export function SubagentRow({
  agent,
  isLast,
  now,
}: {
  agent: Subagent;
  isLast: boolean;
  now: number;
}) {
  const glyph = agent.status === 'running' ? '●' : agent.status === 'needs_you' ? '◐' : '✓';
  const color = agent.status === 'needs_you' ? CORAL : undefined;
  return (
    <Box>
      <Text dimColor>{`  ${isLast ? '└' : '├'} `}</Text>
      <Text color={color} dimColor={agent.status === 'done'}>
        {glyph} {oneLine(agent.label, 44)}
      </Text>
      <Text dimColor>  {formatAge(now - agent.updatedAt)}</Text>
    </Box>
  );
}

/** Collapsed chip when every subagent is finished: `+3✓` */
export function SubagentChip({ agents }: { agents: Subagent[] }) {
  return (
    <Box>
      <Text dimColor>{`    +${agents.length}✓`}</Text>
    </Box>
  );
}
