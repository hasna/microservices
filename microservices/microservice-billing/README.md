# @hasna/microservice-billing

> Billing microservice — plans, subscriptions, invoices, Stripe webhooks, checkout — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-billing
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-billing migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-billing serve --port 3001

# Start the MCP server (for AI agents)
microservice-billing mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-billing'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `BILLING_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-billing migrate    Run database migrations
microservice-billing serve      Start HTTP API server
microservice-billing mcp        Start MCP server
microservice-billing status     Show connection status
```

## License

Apache-2.0
