// One line of chrome: key hints, cmux state, transient action errors.

import React from 'react';
import { Box, Text } from 'ink';
import { CORAL } from '../theme';

export function StatusBar({
  mode,
  cmuxUp,
  error,
}: {
  mode: 'list' | 'detail' | 'filter' | 'compose';
  cmuxUp: boolean;
  error: string | null;
}) {
  const hints =
    mode === 'list'
      ? '⇅ nav · ⏎ detail · m msg · y/n · g go · / filter · x agents · . stale · q quit'
      : mode === 'detail'
        ? 'm msg · y/n · g go · esc back'
        : mode === 'compose'
          ? '⏎ send · esc cancel'
          : '⏎ apply · esc clear';
  return (
    <Box>
      {error ? (
        <Text color={CORAL}>{error}</Text>
      ) : (
        <Text dimColor>{hints}</Text>
      )}
      {!cmuxUp ? <Text dimColor>  · cmux offline — read-only</Text> : null}
    </Box>
  );
}
