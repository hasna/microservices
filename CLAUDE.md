# open-microservices

## Project Overview
Mini business apps for AI agents. Each microservice has its own SQLite database stored in `.microservices/<service-name>/data.db`.

## Architecture
- **Hub**: `src/` — registry, installer, runner, CLI, MCP server (management layer)
- **Microservices**: `microservices/microservice-<name>/` — individual apps with own DB, CLI, MCP
- **Data**: `.microservices/microservice-<name>/data.db` — per-service SQLite in WAL mode

## Key Files
- `src/lib/registry.ts` — all microservice metadata and categories
- `src/lib/installer.ts` — copies services to .microservices/
- `src/lib/database.ts` — shared SQLite utilities
- `src/lib/runner.ts` — subprocess execution of service CLIs
- `src/mcp/index.ts` — hub MCP server
- `src/cli/index.tsx` — hub CLI with Commander + React/Ink TUI

## Adding a New Microservice
1. Create `microservices/microservice-<name>/` with: `src/db/`, `src/cli/`, `src/mcp/`
2. Add migrations in `src/db/migrations.ts`
3. Add database connection in `src/db/database.ts` (copy from microservice-contacts)
4. Implement CRUD operations in `src/db/<entity>.ts`
5. Build CLI in `src/cli/index.ts` with Commander
6. Build MCP server in `src/mcp/index.ts`
7. Add entry to `src/lib/registry.ts`
8. Add tests

## Running Tests
```bash
bun test
```

## Build
```bash
bun run build
```
