# @hasna/microservice-auth

> Auth microservice — users, sessions, JWT, magic links, OAuth, 2FA, API keys — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-auth
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-auth migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-auth serve --port 3001

# Start the MCP server (for AI agents)
microservice-auth mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-auth'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-auth migrate    Run database migrations
microservice-auth serve      Start HTTP API server
microservice-auth mcp        Start MCP server
microservice-auth status     Show connection status
```

## License

Apache-2.0
