// The conductor: subscribes to the store, owns mode/selection/filter state,
// routes input, and drives the refresh loops.

import React, { useEffect, useMemo, useState } from 'react';
import { Box, useApp, useInput, useStdout } from 'ink';
import type { CastStore } from '../model';
import { sortSessions } from '../model';
import type { Session } from '../types';
import type { ActionDeps } from '../actions';
import { approve, deny, focus, message } from '../actions';
import { SessionList, flatten } from './SessionList';
import { DetailOverlay } from './DetailOverlay';
import { StatusBar } from './StatusBar';

type Mode = 'list' | 'detail' | 'filter' | 'compose';

export function App({
  store,
  actionDeps,
  readStale,
}: {
  store: CastStore;
  actionDeps: ActionDeps;
  readStale: () => Session[];
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 100;
  const heightTotal = stdout?.rows ?? 30;

  const [, setVersion] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const [showSubagents, setShowSubagents] = useState(true);
  const [showStale, setShowStale] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);

  // store → re-render
  useEffect(() => store.subscribe(() => setVersion((v) => v + 1)), [store]);

  // spinner + age tick (8fps keeps braille smooth; cheap at this row count)
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => f + 1), 125);
    return () => clearInterval(t);
  }, []);

  // hot transcripts every 5s
  useEffect(() => {
    const t = setInterval(() => store.refreshHotDetails(), 5000);
    return () => clearInterval(t);
  }, [store]);

  const now = Date.now();
  const all = store.snapshotAll();
  const withStale = showStale
    ? [...all, ...readStale().map((s) => ({ ...s, row: 'stale' as const }))]
    : all;
  const filtered = filter
    ? withStale.filter((s) =>
        `${s.info.name ?? ''} ${s.info.cwd}`.toLowerCase().includes(filter.toLowerCase()),
      )
    : withStale;
  const grouped = useMemo(() => sortSessions(filtered), [filtered]);
  const { items, nav } = useMemo(
    () => flatten(grouped, showSubagents),
    [grouped, showSubagents],
  );

  const sel = Math.min(selected, Math.max(0, nav.length - 1));
  const current: Session | undefined = nav[sel];

  // selected session's transcript every 2s (and immediately on selection)
  useEffect(() => {
    if (!current) return;
    store.refreshDetail(current.info.sessionId);
    const t = setInterval(() => store.refreshDetail(current.info.sessionId), 2000);
    return () => clearInterval(t);
  }, [store, current?.info.sessionId]);

  const flash = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  const runAction = (fn: (s: Session, d: ActionDeps) => Promise<{ ok: boolean; reason?: string }>) => {
    if (!current) return;
    fn(current, actionDeps).then((r) => {
      if (!r.ok) flash(('reason' in r && r.reason) || 'action failed');
      store.refreshDetail(current.info.sessionId);
    });
  };

  useInput(
    (input, key) => {
      if (mode === 'compose') {
        if (key.escape) {
          setMode('detail');
          setDraft('');
        }
        return; // TextInput owns everything else
      }
      if (mode === 'filter') {
        if (key.escape) {
          setFilter(null);
          setMode('list');
        } else if (key.return) {
          setMode('list');
        } else if (key.backspace || key.delete) {
          setFilter((f) => (f && f.length > 0 ? f.slice(0, -1) : ''));
        } else if (input && !key.ctrl && !key.meta) {
          setFilter((f) => (f ?? '') + input);
        }
        return;
      }

      // list + detail shared
      if (input === 'q' && mode === 'list') return exit();
      if (key.escape) return setMode('list');
      if (input === 'g') return runAction(focus);
      if (input === 'y') return runAction(approve);
      if (input === 'n') return runAction(deny);
      if (input === 'm') {
        if (!current) return;
        if (!current.surface?.workspace) return flash('view-only · not in cmux');
        setMode('compose');
        return;
      }

      if (mode === 'list') {
        if (key.downArrow || input === 'j') setSelected((s) => Math.min(s + 1, nav.length - 1));
        else if (key.upArrow || input === 'k') setSelected((s) => Math.max(s - 1, 0));
        else if (key.return) {
          if (current) {
            store.refreshDetail(current.info.sessionId);
            setMode('detail');
          }
        } else if (input === '/') setMode('filter');
        else if (input === 'x') setShowSubagents((v) => !v);
        else if (input === '.') setShowStale((v) => !v);
      }
    },
    { isActive: true },
  );

  const submitMessage = (text: string) => {
    setDraft('');
    setMode('detail');
    if (!current) return;
    message(current, text, actionDeps).then((r) => {
      if (!r.ok) flash('reason' in r && r.reason ? r.reason : 'send failed');
    });
  };

  const body =
    (mode === 'detail' || mode === 'compose') && current ? (
      <DetailOverlay
        session={current}
        composerFocus={mode === 'compose'}
        draft={draft}
        onDraft={setDraft}
        onSubmit={submitMessage}
        width={width}
        height={heightTotal - 2}
        now={now}
      />
    ) : (
      <SessionList
        grouped={grouped}
        items={items}
        nav={nav}
        selected={sel}
        frame={frame}
        width={width}
        height={heightTotal - 2}
        now={now}
        filter={mode === 'filter' || filter ? filter ?? '' : null}
      />
    );

  return (
    <Box flexDirection="column">
      {body}
      <StatusBar mode={mode} cmuxUp={store.cmuxUp} error={error} />
    </Box>
  );
}
