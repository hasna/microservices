# @hasna/microservice-audit

> Audit microservice — immutable event log, tamper-evident checksums, retention policies — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-audit
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-audit migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-audit serve --port 3001

# Start the MCP server (for AI agents)
microservice-audit mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-audit'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUDIT_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-audit migrate    Run database migrations
microservice-audit serve      Start HTTP API server
microservice-audit mcp        Start MCP server
microservice-audit status     Show connection status
```

## License

Apache-2.0
