# @hasna/microservice-onboarding

> Onboarding microservice — flows, steps, and user progress tracking — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-onboarding
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-onboarding migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-onboarding serve --port 3001

# Start the MCP server (for AI agents)
microservice-onboarding mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-onboarding'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ONBOARDING_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-onboarding migrate    Run database migrations
microservice-onboarding serve      Start HTTP API server
microservice-onboarding mcp        Start MCP server
microservice-onboarding status     Show connection status
```

## License

Apache-2.0
