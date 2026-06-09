# cast

A terminal dashboard for **every** Claude Code session running on your machine —
across every directory, in one dense view. See which sessions need you, read
their conversation tails, and message them directly without leaving the
dashboard.

```
cast · 3 need you · 12 busy · 32 idle · 47 sessions
── NEEDS YOU ───────────────────────────────────────────────────
◐ ARIA Proposals SCENT   12m  Bash · rm -rf node_modules && bun install
◐ Travel                  2h  "Which dates work for the Chicago trip?"
── BIOBRAIN_REBUILD · 28 ───────────────────────────────────────
● Gene-Linking       ⡿    3s  Searching ontology files for GO terms
  ├ ● explore: map MOC links              2m
  └ ◐ verify: check 40 tagged notes       8m
○ BioHub 2026             4h  retagged regen-med notes
── GITHUB_REPOSITORIES · 6 ─────────────────────────────────────
● Cast Rebuild       ⣻    1s  Editing src/components/Dashboard.tsx
⇅ nav · ⏎ detail · m msg · y/n approve · g go · / filter · q
```

## Quick start

```bash
bun install
bun run src/cli.ts        # the dashboard
```

There is **nothing to install** — no hooks, no server, no database. cast reads
state Claude Code and [cmux](https://github.com/manaflow-ai/cmux) already keep,
so every running session shows up automatically the moment you launch it.

```bash
bun run src/cli.ts          # interactive dashboard (default)
bun run src/cli.ts list     # plain TSV of live sessions, for scripting
bun run src/cli.ts doctor   # check that all data sources are reachable
```

## What you can do

| Key | Action |
|-----|--------|
| `↑`/`↓` or `j`/`k` | navigate |
| `⏎` | open the detail overlay (conversation tail, pending request, composer) |
| `m` | message the selected session — type, `⏎` sends it into that session's prompt |
| `y` / `n` | approve / deny a pending permission request (guarded — see below) |
| `g` | jump to (focus) the session's cmux tab to take over manually |
| `/` | filter by name or project |
| `x` | show/hide subagent rows |
| `.` | show/hide stale sessions (file present, process gone) |
| `Esc` | back · `q` quit |

**Row glyphs:** `◐` needs you (coral) · `●` busy (with spinner) · `○` idle ·
`◌` stale. Needs-you sessions bubble to a band at the top, sorted by how long
they've been waiting. Everything else is grouped by project directory, most
recently active first.

**Guarded actions:** before `y`/`n` sends a keystroke, cast reads the session's
screen and confirms a permission prompt is actually visible. If it isn't (you
already answered it in the tab, say), cast refuses and refreshes rather than
typing blindly into a live session.

## How it works

cast is a **stateless reader over a cmux control plane**. Three adapters, each
the single owner of one data source's schema:

| Adapter | Source | Provides |
|---------|--------|----------|
| `sources/sessions.ts` | `~/.claude/sessions/<pid>.json` | discovery, names, idle/busy, liveness (PID check) |
| `sources/transcripts.ts` | `~/.claude/projects/<cwd>/<id>.jsonl` | conversation tail, pending request, TodoWrite progress, subagents |
| `sources/cmux.ts` | `cmux events` stream + commands | live needs-you alerts, pid→workspace mapping, send / read-screen / focus |

`model.ts` merges them into one sorted session tree and keeps it fresh; `ui/`
renders it; `actions.ts` sends messages and guarded approvals back through cmux.
Because all state is re-derivable from disk and cmux within ~1s, restarting cast
loses nothing.

A session is targeted by its **cmux workspace** (`--workspace=<id>`), resolved
from the live process tree (`cmux top`) and kept current by hook/status events.
Sessions not running under cmux still appear, but are **view-only** (no input
path) and marked as such.

## Requirements

- [Bun](https://bun.sh)
- [cmux](https://github.com/manaflow-ai/cmux) for messaging and actions
  (sessions in other terminals still appear, read-only)

## Tech stack

Bun · TypeScript · [Ink](https://github.com/vadimdemedes/ink) (React for the
terminal) · Commander. Tests with `bun test` against fixtures captured from the
live system.

## License

MIT
