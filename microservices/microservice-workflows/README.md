# @hasna/microservice-workflows

> DAG-based workflow engine for durable, long-running fan-out workflows — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-workflows
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-workflows migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-workflows serve --port 3001

# Start the MCP server (for AI agents)
microservice-workflows mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-workflows'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `WORKFLOWS_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-workflows migrate    Run database migrations
microservice-workflows serve      Start HTTP API server
microservice-workflows mcp        Start MCP server
microservice-workflows status     Show connection status
```

## License

Apache-2.0
