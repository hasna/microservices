# @hasna/microservice-memory

> Memory microservice — vector search, semantic recall, collections, embeddings — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-memory
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-memory migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-memory serve --port 3001

# Start the MCP server (for AI agents)
microservice-memory mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-memory'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `MEMORY_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-memory migrate    Run database migrations
microservice-memory serve      Start HTTP API server
microservice-memory mcp        Start MCP server
microservice-memory status     Show connection status
```

## License

Apache-2.0
