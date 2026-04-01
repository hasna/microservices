# @hasna/microservice-__name__

> __NAME__ — part of [@hasna/microservices](https://github.com/hasna/microservices)

DESCRIPTION

## Install

```bash
bun install -g @hasna/microservice-__name__
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-__name__ migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-__name__ serve --port 3001

# Start the MCP server (for AI agents)
microservice-__name__ mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-__name__'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `____NAME_____PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-__name__ migrate    Run database migrations
microservice-__name__ serve      Start HTTP API server
microservice-__name__ mcp        Start MCP server
microservice-__name__ status     Show connection status
```

## License

Apache-2.0
