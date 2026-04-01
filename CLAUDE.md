# open-microservices

## Project Overview
Production-grade microservice building blocks for SaaS apps. Each microservice is an independent npm package (`@hasna/microservice-<name>`) with its own PostgreSQL schema, HTTP API (standalone mode), MCP server, and CLI. This repo also contains the `@hasna/microservices` meta-package that provides a registry, installer, and hub MCP/CLI for managing them all.

## The 21 Microservices

| Category | Services |
|----------|----------|
| **Identity** | `auth` |
| **Organization** | `teams` |
| **Monetization** | `billing` |
| **Communication** | `notify` |
| **Storage** | `files` |
| **Observability** | `audit`, `usage`, `traces` |
| **Growth** | `flags`, `onboarding`, `waitlist` |
| **Infrastructure** | `jobs`, `webhooks` |
| **AI Layer** | `llm`, `memory`, `search`, `knowledge`, `sessions`, `guardrails`, `agents`, `prompts` |

## Architecture

### Embed-First
Each microservice works as an imported TypeScript library connecting to any PostgreSQL instance. Use its own schema prefix (e.g. `auth.*`) for isolation.

### Standalone Mode
Each microservice can also run as an independent HTTP service:
```bash
microservice-auth serve --port 3001
```

### Two Modes of Use
```ts
// Embedded — import directly in your Next.js/Bun app
import { auth } from '@hasna/microservice-auth'
const session = await auth.validateToken(req.headers.authorization)

// Standalone — run as HTTP service, call via fetch
const res = await fetch('http://localhost:3001/auth/session', { headers: { Authorization: ... } })
```

## Folder Structure

```
src/
  lib/
    registry.ts      — list of all 21 microservices with metadata
    installer.ts     — installs npm packages globally via bun
    runner.ts        — runs microservice binaries
  cli/
    index.tsx        — hub CLI (list, install, status, migrate-all, check-env)
  mcp/
    index.ts         — hub MCP server

microservices/
  _template/         — canonical template for new microservices
  microservice-auth/
  microservice-teams/
  microservice-billing/
  microservice-notify/
  microservice-files/
  microservice-audit/
  microservice-usage/
  microservice-traces/
  microservice-flags/
  microservice-onboarding/
  microservice-waitlist/
  microservice-jobs/
  microservice-webhooks/
  microservice-llm/
  microservice-memory/
  microservice-search/
  microservice-knowledge/
  microservice-sessions/
  microservice-guardrails/
  microservice-agents/
  microservice-prompts/
```

## Each Microservice Structure

```
microservice-<name>/
  src/
    db/
      migrations.ts  — PostgreSQL migrations (schema.<name>.*)
      queries.ts     — typed query functions
    lib/
      index.ts       — core business logic (embed-first)
    http/
      index.ts       — REST API server (standalone mode)
      routes.ts      — route handlers
    mcp/
      index.ts       — MCP server
    cli/
      index.ts       — Commander CLI
  package.json       — @hasna/microservice-<name>
  tsconfig.json
```

## Key Conventions

- **Schema prefix**: every table lives in its own PostgreSQL schema (`auth.users`, not `users`)
- **Env config**: `DATABASE_URL` is required; service-specific env vars are optional
- **Embedded first**: core logic works without HTTP server
- **Independent**: no cross-service imports; apps compose services themselves
- **Binary**: `microservice-<name>` CLI installed globally via bun

## Running Tests
```bash
bun test
```

## Build
```bash
bun run build
```

## API Gateway
Since the 21 microservices run on independent ports, you can run the API Gateway to route traffic over a single port (8000) using path prefixes (`/auth/*`, `/billing/*`).
```bash
bun run gateway
```

## Install & Run All Microservices
```bash
docker-compose up -d
bun install
bun run build:all
microservices init-all --db postgres://postgres:password@localhost:5432/microservices
microservices serve-all
```

## Adding a New Microservice
1. Run the scaffold command: `bun run dev scaffold <name>` (or `microservices scaffold <name>` if installed globally)
2. Add an entry to `src/lib/registry.ts`
3. Run `bun install` to link the workspace
4. Run `bun run build:all`
5. Implement schema, core logic, HTTP API, MCP, CLI
