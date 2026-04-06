# @hasna/microservice-notify

> Notify microservice — notifications, preferences, templates, webhooks, delivery log — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-notify
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-notify migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-notify serve --port 3001

# Start the MCP server (for AI agents)
microservice-notify mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-notify'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NOTIFY_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-notify migrate    Run database migrations
microservice-notify serve      Start HTTP API server
microservice-notify mcp        Start MCP server
microservice-notify status     Show connection status
```

## License

Apache-2.0
