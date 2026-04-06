# @hasna/microservice-waitlist

> Waitlist microservice — campaign management, referral tracking, priority scoring — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-waitlist
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-waitlist migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-waitlist serve --port 3001

# Start the MCP server (for AI agents)
microservice-waitlist mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-waitlist'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `WAITLIST_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-waitlist migrate    Run database migrations
microservice-waitlist serve      Start HTTP API server
microservice-waitlist mcp        Start MCP server
microservice-waitlist status     Show connection status
```

## License

Apache-2.0
