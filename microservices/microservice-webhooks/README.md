# @hasna/microservice-webhooks

> Webhooks microservice — endpoint registry, event delivery, HMAC signatures, retry with backoff — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-webhooks
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-webhooks migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-webhooks serve --port 3001

# Start the MCP server (for AI agents)
microservice-webhooks mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-webhooks'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `WEBHOOKS_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-webhooks migrate    Run database migrations
microservice-webhooks serve      Start HTTP API server
microservice-webhooks mcp        Start MCP server
microservice-webhooks status     Show connection status
```

## License

Apache-2.0
