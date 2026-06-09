// Full-screen session detail: header, pending strip, transcript tail,
// todos, composer. Esc returns to the list exactly where it was.

import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { Session } from '../types';
import { CORAL, RULE, TOOL_MARK, formatAge, tildify } from '../theme';

export function DetailOverlay({
  session: s,
  composerFocus,
  draft,
  onDraft,
  onSubmit,
  width,
  height,
  now,
}: {
  session: Session;
  composerFocus: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onSubmit: (v: string) => void;
  width: number;
  height: number;
  now: number;
}) {
  const name = s.info.name ?? s.info.sessionId.slice(0, 8);
  const pending = s.detail?.pending ?? null;
  const tailBudget = Math.max(3, height - 7 - (pending ? 2 : 0));
  const tail = (s.detail?.tail ?? []).slice(-tailBudget);
  const rule = RULE.repeat(Math.max(8, width - 2));

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={s.row === 'needs_you' ? CORAL : undefined}>
          {name}
        </Text>
        <Text dimColor>
          {'  '}
          {tildify(s.info.cwd)} · pid {s.info.pid} · {s.info.status}{' '}
          {formatAge(now - s.info.updatedAt)}
        </Text>
      </Box>
      <Text> </Text>
      {pending ? (
        <>
          <Box>
            <Text color={CORAL} bold>
              ◐ PENDING{'  '}
            </Text>
            <Text color={CORAL}>
              {pending.tool} · {pending.summary}
            </Text>
            <Text dimColor>{'   '}[y] approve · [n] deny</Text>
          </Box>
          <Text> </Text>
        </>
      ) : null}
      <Text dimColor>{rule}</Text>
      {tail.length === 0 ? <Text dimColor> no transcript found</Text> : null}
      {tail.map((t, i) => (
        <Box key={i}>
          {t.role === 'user' ? (
            <Text bold> me› </Text>
          ) : t.role === 'assistant' ? (
            <Text dimColor> cl› </Text>
          ) : (
            <Text dimColor>{`  ${TOOL_MARK}  `}</Text>
          )}
          <Text dimColor={t.role === 'tool'} wrap="truncate-end">
            {t.text}
          </Text>
        </Box>
      ))}
      {s.detail?.todos ? (
        <Text dimColor>
          todos {s.detail.todos.done}/{s.detail.todos.total}
          {s.detail.todos.current ? ` · ${s.detail.todos.current}` : ''}
        </Text>
      ) : null}
      <Text dimColor>{rule}</Text>
      <Box>
        <Text color={composerFocus ? CORAL : undefined} bold={composerFocus}>
          {' › '}
        </Text>
        {composerFocus ? (
          <TextInput value={draft} onChange={onDraft} onSubmit={onSubmit} />
        ) : (
          <Text dimColor>{s.surface?.surface ? 'm to message' : 'view-only · not in cmux'}</Text>
        )}
      </Box>
    </Box>
  );
}
