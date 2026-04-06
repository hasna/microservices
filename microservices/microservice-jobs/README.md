# @hasna/microservice-jobs

> Jobs microservice — background jobs, priority queues, cron scheduling, retries with backoff — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-jobs
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-jobs migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-jobs serve --port 3001

# Start the MCP server (for AI agents)
microservice-jobs mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-jobs'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JOBS_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-jobs migrate    Run database migrations
microservice-jobs serve      Start HTTP API server
microservice-jobs mcp        Start MCP server
microservice-jobs status     Show connection status
```

## License

Apache-2.0
