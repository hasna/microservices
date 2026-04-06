# @hasna/microservice-traces

> Traces microservice — LLM trace and span tracking with stats and tree visualization — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-traces
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-traces migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-traces serve --port 3001

# Start the MCP server (for AI agents)
microservice-traces mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-traces'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `TRACES_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-traces migrate    Run database migrations
microservice-traces serve      Start HTTP API server
microservice-traces mcp        Start MCP server
microservice-traces status     Show connection status
```

## License

Apache-2.0
