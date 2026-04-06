# @hasna/microservice-cache

> Distributed TTL cache with per-tenant namespaces, LRU eviction, and PostgreSQL backing store — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-cache
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-cache migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-cache serve --port 3001

# Start the MCP server (for AI agents)
microservice-cache mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-cache'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `CACHE_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-cache migrate    Run database migrations
microservice-cache serve      Start HTTP API server
microservice-cache mcp        Start MCP server
microservice-cache status     Show connection status
```

## License

Apache-2.0
