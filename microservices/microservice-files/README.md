# @hasna/microservice-files

> Files microservice — upload, manage, and serve files with S3 and local storage backends — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-files
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-files migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-files serve --port 3001

# Start the MCP server (for AI agents)
microservice-files mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-files'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `FILES_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-files migrate    Run database migrations
microservice-files serve      Start HTTP API server
microservice-files mcp        Start MCP server
microservice-files status     Show connection status
```

## License

Apache-2.0
