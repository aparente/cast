# cast

A stateless terminal dashboard for every Claude Code session on the machine.

## Project Overview
- **Purpose**: Monitor and message all running Claude sessions, across every
  directory, from one dense (Tufte-style) view.
- **Stack**: Bun, TypeScript, Ink (React for terminal), Commander.
- **Design**: Stateless reader over a cmux control plane. No server, no SQLite,
  no hooks of our own — everything is re-derived from data Claude Code and cmux
  already maintain. See `docs/superpowers/specs/2026-06-09-cast-rebuild-design.md`.

## Architecture
```
src/
  cli.ts                  # entry: tui (default) | list | doctor
  types.ts                # model types
  theme.ts                # palette, glyphs, formatAge/oneLine/tildify
  sources/sessions.ts     # ~/.claude/sessions/<pid>.json → discovery, idle/busy
  sources/transcripts.ts  # transcript JSONL → tail, pending, todos, subagents
  sources/cmux.ts         # cmux events stream + send/read-screen/select wrappers
  model.ts                # merge + sort + CastStore (pub/sub, refresh policy)
  actions.ts              # guarded message / approve / deny / focus
  ui/                     # App, SessionList, Row, DetailOverlay, StatusBar
```
Each adapter is the sole owner of one source's schema, so schema drift breaks
one file. Parsing is pure functions (string/JSON in → typed out); I/O wrappers
are thin and never throw (`{ok, error?}`).

## Key invariant: targeting cmux
A session is addressed by its **cmux workspace** (`--workspace=<id>`). The same
workspace id appears as the hook `workspace_id`, the `set_status --tab`, and the
2nd field of a notification line. `--workspace=` reliably hits the terminal;
surface UUIDs do **not** (they distinguish tab-surfaces from terminal panels).
Resolve pid→workspace from `cmux top --all --processes --format tsv`.

## Commands
```bash
bun run src/cli.ts          # dashboard
bun run src/cli.ts list     # TSV of sessions
bun run src/cli.ts doctor   # check data sources
bun test                    # unit + ink-testing-library tests
bunx tsc --noEmit           # typecheck (strict)
```

## Development
- Use `bun` for everything (not npm/node).
- Keep parsing pure and tested against fixtures in `tests/fixtures/` captured
  from the real system; keep cmux/process I/O in thin wrappers.
- Ink components render to the terminal; adjacent `<Text>` nodes collapse
  trailing whitespace — bake separators mid-string or nest inside one wrapping
  `<Text>`.

---

## Bun Guidelines

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`
- Bun automatically loads .env, so don't use dotenv.

### APIs
- `Bun.serve()` for HTTP/WebSocket servers
- `bun:sqlite` for SQLite
- `Bun.$` for shell commands instead of execa
- `Bun.file` over `node:fs` readFile/writeFile
