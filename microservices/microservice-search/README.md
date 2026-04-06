# @hasna/microservice-search

> Search microservice — full-text, semantic (pgvector), and hybrid document search — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-search
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-search migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-search serve --port 3001

# Start the MCP server (for AI agents)
microservice-search mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-search'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SEARCH_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-search migrate    Run database migrations
microservice-search serve      Start HTTP API server
microservice-search mcp        Start MCP server
microservice-search status     Show connection status
```

## License

Apache-2.0
