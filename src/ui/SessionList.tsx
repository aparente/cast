// The dense list: stat line, NEEDS YOU band, project groups, viewport scroll.

import React from 'react';
import { Box, Text } from 'ink';
import type { Grouped } from '../model';
import type { Session } from '../types';
import { CORAL, RULE } from '../theme';
import { SessionRow, SubagentRow, SubagentChip } from './Row';

type Item =
  | { kind: 'rule'; label: string; coral: boolean; count?: number }
  | { kind: 'session'; session: Session; index: number }
  | { kind: 'subagent'; session: Session; agentIdx: number }
  | { kind: 'chip'; session: Session };

/** Flatten grouped sessions into renderable items + the navigable order. */
export function flatten(g: Grouped, showSubagents: boolean): { items: Item[]; nav: Session[] } {
  const items: Item[] = [];
  const nav: Session[] = [];

  const pushSession = (s: Session) => {
    const index = nav.length;
    nav.push(s);
    items.push({ kind: 'session', session: s, index });
    const agents = s.detail?.subagents ?? [];
    if (!showSubagents || agents.length === 0) return;
    const live = agents.some((a) => a.status !== 'done');
    if (live) {
      agents.forEach((_, i) => items.push({ kind: 'subagent', session: s, agentIdx: i }));
    } else {
      items.push({ kind: 'chip', session: s });
    }
  };

  if (g.needsYou.length > 0) {
    items.push({ kind: 'rule', label: 'NEEDS YOU', coral: true });
    g.needsYou.forEach(pushSession);
  }
  for (const group of g.groups) {
    items.push({ kind: 'rule', label: group.label, coral: false, count: group.sessions.length });
    group.sessions.forEach(pushSession);
  }
  return { items, nav };
}

function Rule({ label, coral, count, width }: { label: string; coral: boolean; count?: number; width: number }) {
  const text = count !== undefined ? `${label} · ${count}` : label;
  const lead = RULE.repeat(2);
  const tail = RULE.repeat(Math.max(0, width - text.length - 6));
  return (
    <Text color={coral ? CORAL : undefined} dimColor={!coral}>
      {lead} {text} {tail}
    </Text>
  );
}

export function SessionList({
  grouped,
  items,
  nav,
  selected,
  frame,
  width,
  height,
  now,
  filter,
}: {
  grouped: Grouped;
  items: Item[];
  nav: Session[];
  selected: number;
  frame: number;
  width: number;
  height: number;
  now: number;
  filter: string | null;
}) {
  const { counts } = grouped;
  const statLine = `cast · ${counts.needsYou} need you · ${counts.busy} busy · ${counts.idle} idle · ${counts.total} sessions`;

  // keep the selected session's line in the viewport
  const selectedLine = items.findIndex((it) => it.kind === 'session' && it.index === selected);
  const usable = Math.max(3, height);
  let start = 0;
  if (selectedLine >= 0 && selectedLine >= usable - 1) start = selectedLine - usable + 2;
  const visible = items.slice(start, start + usable);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>cast</Text>
        <Text dimColor>{statLine.slice(4)}</Text>
        {filter !== null ? <Text color={CORAL}>  /{filter}</Text> : null}
      </Box>
      {visible.map((it, i) => {
        if (it.kind === 'rule') {
          return <Rule key={`r${i}`} label={it.label} coral={it.coral} count={it.count} width={width} />;
        }
        if (it.kind === 'session') {
          return (
            <SessionRow
              key={it.session.info.pid}
              session={it.session}
              selected={it.index === selected}
              frame={frame}
              width={width}
              now={now}
            />
          );
        }
        if (it.kind === 'subagent') {
          const agents = it.session.detail!.subagents;
          return (
            <SubagentRow
              key={`${it.session.info.pid}-a${it.agentIdx}`}
              agent={agents[it.agentIdx]!}
              isLast={it.agentIdx === agents.length - 1}
              now={now}
            />
          );
        }
        return <SubagentChip key={`${it.session.info.pid}-chip`} agents={it.session.detail!.subagents} />;
      })}
      {nav.length === 0 ? (
        <Text dimColor>{filter ? 'no sessions match' : 'no live claude sessions found'}</Text>
      ) : null}
    </Box>
  );
}
