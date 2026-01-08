#!/usr/bin/env bun
import { program } from 'commander';
import { render } from 'ink';
import React from 'react';
import { Dashboard } from './components/Dashboard.js';
import { startServer, DEFAULT_PORT } from './server.js';
import { sessionStore } from './store.js';

program
  .name('csm')
  .description('Claude Session Manager - Terminal UI for managing Claude Code sessions')
  .version('0.1.0');

program
  .command('dashboard', { isDefault: true })
  .description('Launch the session dashboard (starts server automatically)')
  .option('-v, --view <mode>', 'View mode: list, kanban', 'list')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action((options) => {
    const port = parseInt(options.port, 10);

    // Start the server to receive hook events
    const server = startServer(port);

    // Render the dashboard
    const { unmount } = render(
      React.createElement(Dashboard, {
        viewMode: options.view,
        serverPort: server.port,
      })
    );

    // Cleanup on exit
    process.on('SIGINT', () => {
      server.stop();
      unmount();
      process.exit(0);
    });
  });

program
  .command('server')
  .description('Run only the hook event server (headless)')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action((options) => {
    const port = parseInt(options.port, 10);
    const server = startServer(port);

    console.log('Press Ctrl+C to stop');

    process.on('SIGINT', () => {
      server.stop();
      process.exit(0);
    });
  });

program
  .command('list')
  .description('List all active Claude Code sessions')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (options) => {
    try {
      const res = await fetch(`http://localhost:${options.port}/sessions`);
      const sessions = await res.json() as Array<{ name: string; status: string; alerting: boolean; currentTask?: string }>;

      if (sessions.length === 0) {
        console.log('No active sessions');
        return;
      }

      console.log(`\n${sessions.length} active session(s):\n`);
      for (const s of sessions) {
        const alert = s.alerting ? ' [ALERT]' : '';
        console.log(`  ${s.name} (${s.status})${alert}`);
        if (s.currentTask) console.log(`    └─ ${s.currentTask}`);
      }
      console.log();
    } catch {
      console.error('Dashboard server not running. Start with: csm dashboard');
    }
  });

program
  .command('clear')
  .description('Clear all sessions from the database')
  .action(() => {
    const count = sessionStore.all().length;
    for (const session of sessionStore.all()) {
      sessionStore.remove(session.id);
    }
    console.log(`Cleared ${count} session(s)`);
  });

program
  .command('prune')
  .description('Remove stale sessions older than N minutes')
  .option('-m, --minutes <minutes>', 'Minutes threshold', '60')
  .action((options) => {
    const minutes = parseInt(options.minutes, 10);
    const count = sessionStore.pruneStale(minutes);
    console.log(`Pruned ${count} stale session(s) older than ${minutes} minutes`);
  });

program
  .command('install-hooks')
  .description('Show instructions for installing hooks')
  .action(() => {
    const scriptsPath = new URL('../scripts', import.meta.url).pathname;

    console.log(`
Claude Session Manager - Hook Installation
==========================================

Add the following to your ~/.claude/settings.json:

{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${scriptsPath}/session-start.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${scriptsPath}/session-end.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${scriptsPath}/notification.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "${scriptsPath}/tool-use.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${scriptsPath}/user-prompt.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${scriptsPath}/subagent-stop.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}

After updating, restart your Claude Code sessions for hooks to take effect.
`);
  });

program.parse();
