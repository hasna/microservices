# @hasna/microservice-llm

> LLM gateway microservice — multi-provider chat, usage tracking, cost calculation — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-llm
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-llm migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-llm serve --port 3001

# Start the MCP server (for AI agents)
microservice-llm mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-llm'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `LLM_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-llm migrate    Run database migrations
microservice-llm serve      Start HTTP API server
microservice-llm mcp        Start MCP server
microservice-llm status     Show connection status
```

## License

Apache-2.0
