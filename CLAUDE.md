# open-microservices

## Project Overview
Production-grade microservice building blocks for SaaS apps. Each microservice is an independent npm package (`@hasna/microservice-<name>`) with its own PostgreSQL schema, HTTP API (standalone mode), MCP server, and CLI. This repo also contains the `@hasna/microservices` meta-package that provides a registry, installer, and hub MCP/CLI for managing them all.

## The 8 Microservices

| Service | Package | Schema | Purpose |
|---------|---------|--------|---------|
| **auth** | `@hasna/microservice-auth` | `auth.*` | Users, sessions, JWT, OAuth, 2FA, API keys |
| **teams** | `@hasna/microservice-teams` | `teams.*` | Workspaces, members, RBAC, invites |
| **billing** | `@hasna/microservice-billing` | `billing.*` | Stripe subscriptions, plans, invoices |
| **notify** | `@hasna/microservice-notify` | `notify.*` | Email, SMS, in-app, outbound webhooks |
| **files** | `@hasna/microservice-files` | `files.*` | Uploads, S3, presigned URLs, transforms |
| **audit** | `@hasna/microservice-audit` | `audit.*` | Immutable event log, compliance trail |
| **flags** | `@hasna/microservice-flags` | `flags.*` | Feature flags, rollouts, A/B experiments |
| **jobs** | `@hasna/microservice-jobs` | `jobs.*` | Background jobs, queues, cron, retries |

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
    registry.ts      — list of all 8 microservices with metadata
    installer.ts     — installs npm packages globally via bun
    runner.ts        — runs microservice binaries
  cli/
    index.tsx        — hub CLI (list, install, status, migrate-all)
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
  microservice-flags/
  microservice-jobs/
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

## Install a Microservice
```bash
bun install -g @hasna/microservice-auth
microservice-auth init --db postgres://localhost/myapp
microservice-auth migrate
microservice-auth serve
```

## Adding a New Microservice
1. Copy `microservices/_template/` to `microservices/microservice-<name>/`
2. Implement schema, core logic, HTTP API, MCP, CLI
3. Add entry to `src/lib/registry.ts`
4. Publish as `@hasna/microservice-<name>`
