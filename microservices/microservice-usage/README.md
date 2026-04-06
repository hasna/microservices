# @hasna/microservice-usage

> Usage tracking microservice — event ingestion, quota enforcement, aggregate reporting — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-usage
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-usage migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-usage serve --port 3001

# Start the MCP server (for AI agents)
microservice-usage mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-usage'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `USAGE_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-usage migrate    Run database migrations
microservice-usage serve      Start HTTP API server
microservice-usage mcp        Start MCP server
microservice-usage status     Show connection status
```

## License

Apache-2.0
