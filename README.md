# @hasna/microservices

> Production-grade microservice building blocks for SaaS apps.

Each microservice is an **independent npm package** with its own PostgreSQL schema, HTTP API, MCP server, and CLI binary. Install only what you need. Plug into any app.

[![npm](https://img.shields.io/npm/v/@hasna/microservices)](https://www.npmjs.com/package/@hasna/microservices)

## The 8 Microservices

| Package | Binary | Schema | What it does |
|---------|--------|--------|--------------|
| `@hasna/microservice-auth` | `microservice-auth` | `auth.*` | Users, sessions, JWT, magic links, OAuth, 2FA, API keys |
| `@hasna/microservice-teams` | `microservice-teams` | `teams.*` | Workspaces, members, RBAC (owner/admin/member/viewer), invites |
| `@hasna/microservice-billing` | `microservice-billing` | `billing.*` | Stripe subscriptions, plans, invoices, usage-based billing |
| `@hasna/microservice-notify` | `microservice-notify` | `notify.*` | Email, SMS, in-app, outbound webhooks, templates |
| `@hasna/microservice-files` | `microservice-files` | `files.*` | Uploads, S3 storage, presigned URLs, image transforms |
| `@hasna/microservice-audit` | `microservice-audit` | `audit.*` | Immutable event log, compliance trail, retention policies |
| `@hasna/microservice-flags` | `microservice-flags` | `flags.*` | Feature flags, gradual rollouts, A/B experiments |
| `@hasna/microservice-jobs` | `microservice-jobs` | `jobs.*` | Background jobs, priority queues (SKIP LOCKED), cron, retries |

## Install

```bash
# Install one or more
bun install -g @hasna/microservice-auth @hasna/microservice-teams

# Or use the hub CLI to manage all
bun install -g @hasna/microservices
microservices install auth teams billing
```

## Quick Start

```bash
# 1. Install a service
bun install -g @hasna/microservice-auth

# 2. Run migrations against your PostgreSQL
microservice-auth migrate --db postgres://localhost/myapp

# 3. Start the HTTP API (standalone mode)
microservice-auth serve --port 3001

# 4. Or start the MCP server (for AI agents)
microservice-auth mcp
```

## Two Modes: Embedded or Standalone

### Embedded — import in your app

```ts
import { migrate, register, login } from '@hasna/microservice-auth'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

const { user, access_token, session } = await register(sql, {
  email: 'user@example.com',
  password: 'secure-password',
})
```

### Standalone — run as HTTP service

```bash
microservice-auth serve --port 3001
# POST http://localhost:3001/auth/register
# POST http://localhost:3001/auth/login
# GET  http://localhost:3001/auth/session
```

## Complete SaaS Stack Example

```ts
import { register } from '@hasna/microservice-auth'
import { createWorkspace, checkPermission } from '@hasna/microservice-teams'
import { createCheckoutSession } from '@hasna/microservice-billing'
import { sendNotification } from '@hasna/microservice-notify'
import { logEvent } from '@hasna/microservice-audit'
import { evaluateFlag } from '@hasna/microservice-flags'
import { enqueue } from '@hasna/microservice-jobs'

const { user, access_token } = await register(sql, { email, password })
const workspace = await createWorkspace(sql, { name: 'My Company', ownerId: user.id })
const checkout = await createCheckoutSession({ workspaceId: workspace.id, planId, successUrl, cancelUrl, stripeSecretKey })
await sendNotification(sql, { userId: user.id, channel: 'email', type: 'welcome', body: 'Welcome!' })
await logEvent(sql, { actorId: user.id, action: 'user.registered', resourceType: 'user', resourceId: user.id })
const { value } = await evaluateFlag(sql, 'new-onboarding', { userId: user.id })
await enqueue(sql, { type: 'onboarding.setup', payload: { userId: user.id } })
```

## Environment Variables

| Variable | Used by | Required |
|----------|---------|----------|
| `DATABASE_URL` | All services | Yes |
| `JWT_SECRET` | auth | Yes |
| `STRIPE_SECRET_KEY` | billing | Yes |
| `STRIPE_WEBHOOK_SECRET` | billing | Yes |
| `RESEND_API_KEY` | notify (email) | Optional |
| `TWILIO_ACCOUNT_SID` | notify (SMS) | Optional |
| `S3_BUCKET` | files | Optional (falls back to local) |
| `GITHUB_CLIENT_ID` | auth (OAuth) | Optional |
| `GOOGLE_CLIENT_ID` | auth (OAuth) | Optional |

## Hub CLI

```bash
microservices list                    # List all available microservices
microservices install auth teams      # Install specific services
microservices install --all           # Install all 8
microservices status                  # Check what's installed
microservices info auth               # Detailed info + required env
microservices migrate-all             # Run migrations on all installed
microservices run auth status         # Run any CLI command on a service
microservices search stripe           # Search by keyword
```

## Hub MCP Server

For AI agents — add to your Claude config:

```json
{
  "mcpServers": {
    "microservices": {
      "command": "microservices-mcp"
    }
  }
}
```

Tools: `list_microservices`, `search_microservices`, `install_microservice`, `microservice_status`, `run_microservice_command`, `remove_microservice`, `get_microservice_info`

## PostgreSQL Schema Isolation

Each service owns its schema — all on one PostgreSQL instance:

```
auth.*     teams.*     billing.*   notify.*
files.*    audit.*     flags.*     jobs.*
```

## Architecture

- **Runtime**: Bun
- **Database**: PostgreSQL (per-service schemas, migrations built-in)
- **API**: Bun HTTP server (standalone mode)
- **MCP**: `@modelcontextprotocol/sdk` (for AI agents)
- **CLI**: Commander
- **Auth crypto**: Web Crypto API (no external crypto deps)
- **Stripe**: Direct `fetch()` calls (no Stripe SDK)
- **S3**: Manual SigV4 signing via Web Crypto

## Development

```bash
bun install && bun test   # 127 tests, 0 failures
```

With a real database:

```bash
DATABASE_URL=postgres://localhost/test_ms JWT_SECRET=test-secret bun test src/integration.test.ts
```

## License

Apache-2.0 — [Hasna](https://hasna.com)
