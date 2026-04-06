# @hasna/microservice-sessions

> Sessions microservice — conversations, messages, context windows, full-text search, export — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-sessions
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-sessions migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-sessions serve --port 3001

# Start the MCP server (for AI agents)
microservice-sessions mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-sessions'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSIONS_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-sessions migrate    Run database migrations
microservice-sessions serve      Start HTTP API server
microservice-sessions mcp        Start MCP server
microservice-sessions status     Show connection status
```

## License

Apache-2.0
