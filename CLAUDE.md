# Claude Session Manager

A terminal UI for managing multiple Claude Code sessions in VS Code.

## Project Overview
- **Purpose**: Dashboard to monitor and manage concurrent Claude Code sessions
- **Inspiration**: [claude-canvas](https://github.com/dvdsgl/claude-canvas) TUI patterns
- **Stack**: Bun, TypeScript, Ink (React for terminal), Commander.js

## Architecture
```
src/
  cli.ts          # CLI entry point
  components/     # Ink React components
    Dashboard.tsx # Main dashboard view
  types.ts        # Type definitions
  sessions/       # Session discovery & monitoring
```

## Commands
```bash
bun run src/cli.ts          # Launch dashboard
bun run src/cli.ts --help   # Show help
```

## Development
- Use `bun` for all commands (not npm/node)
- Ink components are React components rendered to terminal
- Test with `bun test`

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
