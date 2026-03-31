# @hasna/microservice-NAME

> NAME — part of [@hasna/microservices](https://github.com/hasna/microservices)

DESCRIPTION

## Install

```bash
bun install -g @hasna/microservice-NAME
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-NAME migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-NAME serve --port 3001

# Start the MCP server (for AI agents)
microservice-NAME mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-NAME'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NAME_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-NAME migrate    Run database migrations
microservice-NAME serve      Start HTTP API server
microservice-NAME mcp        Start MCP server
microservice-NAME status     Show connection status
```

## License

Apache-2.0
