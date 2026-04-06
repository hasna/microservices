# @hasna/microservice-flags

> Flags microservice — feature flags, gradual rollouts, A/B experiments, targeting rules — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-flags
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-flags migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-flags serve --port 3001

# Start the MCP server (for AI agents)
microservice-flags mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-flags'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `FLAGS_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-flags migrate    Run database migrations
microservice-flags serve      Start HTTP API server
microservice-flags mcp        Start MCP server
microservice-flags status     Show connection status
```

## License

Apache-2.0
