#!/usr/bin/env bun
// cast — machine-wide Claude Code session dashboard.
//   cast          interactive TUI (default)
//   cast list     plain TSV for scripting
//   cast doctor   check the three data sources

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { CastStore } from './model';
import { readSessions, readStale, watchSessions, SESSIONS_DIR } from './sources/sessions';
import { readDetail, transcriptPath } from './sources/transcripts';
import * as cmux from './sources/cmux';
import { App } from './ui/App';
import { formatAge } from './theme';
import type { Session } from './types';

function buildStore(): CastStore {
  return new CastStore({ readSessions, readDetail });
}

async function tui(): Promise<void> {
  const store = buildStore();
  store.refreshSessions();
  const unwatch = watchSessions(() => store.refreshSessions());
  const stream = cmux.streamEvents(
    (e) => store.applyEvent(e),
    (up) => store.setCmuxUp(up),
  );

  // Map every session to its cmux workspace from the live process tree;
  // live hook/status events keep it current afterward.
  store.seedWorkspaces(await cmux.workspacesByPid());
  store.seedNotifications(await cmux.listNotifications());
  store.refreshHotDetails();

  // Re-resolve workspace mapping periodically for sessions opened later.
  const wsTimer = setInterval(async () => {
    if (store.unmappedPids().length > 0) store.seedWorkspaces(await cmux.workspacesByPid());
  }, 4000);

  const actionDeps = {
    readScreen: cmux.readScreen,
    send: cmux.send,
    sendKey: cmux.sendKey,
    focusTab: cmux.focusTab,
  };

  const staleSessions = (): Session[] =>
    readStale().map((info) => ({
      info,
      row: 'stale' as const,
      alertSince: null,
      detail: null,
      surface: { workspace: null },
    }));

  const { waitUntilExit } = render(
    React.createElement(App, { store, actionDeps, readStale: staleSessions }),
    { exitOnCtrlC: true },
  );
  await waitUntilExit();
  clearInterval(wsTimer);
  stream.stop();
  unwatch();
  process.exit(0);
}

function list(): void {
  const now = Date.now();
  for (const s of readSessions()) {
    console.log(
      [s.pid, s.sessionId, s.status, formatAge(now - s.updatedAt), s.name ?? '-', s.cwd].join('\t'),
    );
  }
}

async function doctor(): Promise<void> {
  let failed = false;
  const check = (ok: boolean, label: string, detail = '') => {
    console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failed = true;
  };

  const sessions = readSessions();
  check(sessions.length > 0, 'session files', `${sessions.length} live sessions in ${SESSIONS_DIR}`);

  const withTranscript = sessions.filter((s) => readDetail(s.cwd, s.sessionId) !== null);
  check(
    sessions.length === 0 || withTranscript.length > 0,
    'transcripts',
    sessions.length > 0
      ? `${withTranscript.length}/${sessions.length} resolvable (e.g. ${transcriptPath(sessions[0]!.cwd, sessions[0]!.sessionId)})`
      : 'no sessions to check',
  );

  const pingOk = await cmux.ping();
  check(pingOk, 'cmux socket', pingOk ? 'ping ok' : 'cmux unreachable — actions disabled');

  if (pingOk) {
    // Probe: emit a log event through cmux and confirm it comes back on the stream.
    const gotEvent = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        stream.stop();
        resolve(false);
      }, 3000);
      const stream = cmux.streamEvents(
        () => {
          clearTimeout(timer);
          stream.stop();
          resolve(true);
        },
        (up) => {
          if (up) Bun.spawn(['cmux', 'log', '--source', 'cast-doctor', 'probe'], { stdout: 'ignore', stderr: 'ignore' });
        },
      );
    });
    check(gotEvent, 'event stream', gotEvent ? 'probe event received' : 'no events within 3s');

    const wsMap = await cmux.workspacesByPid();
    const mapped = sessions.filter((s) => wsMap.has(s.pid)).length;
    check(
      mapped > 0 || sessions.length === 0,
      'workspace mapping',
      `${mapped}/${sessions.length} sessions mapped to a cmux workspace`,
    );
  }

  process.exit(failed ? 1 : 0);
}

const program = new Command()
  .name('cast')
  .description('Machine-wide Claude Code session dashboard');
program.command('list').description('print live sessions as TSV').action(list);
program.command('doctor').description('check data sources').action(doctor);
program.action(tui);
program.parse();
