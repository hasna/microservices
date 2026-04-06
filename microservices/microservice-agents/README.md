# @hasna/microservice-agents

> Agents microservice — agent registry, messaging, task routing, health monitoring — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-agents
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-agents migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-agents serve --port 3001

# Start the MCP server (for AI agents)
microservice-agents mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-agents'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AGENTS_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-agents migrate    Run database migrations
microservice-agents serve      Start HTTP API server
microservice-agents mcp        Start MCP server
microservice-agents status     Show connection status
```

## License

Apache-2.0
