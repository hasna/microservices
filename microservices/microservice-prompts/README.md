# @hasna/microservice-prompts

> Prompts microservice — versioned prompt management, A/B experiments, overrides, variable interpolation — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-prompts
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-prompts migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-prompts serve --port 3001

# Start the MCP server (for AI agents)
microservice-prompts mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-prompts'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PROMPTS_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-prompts migrate    Run database migrations
microservice-prompts serve      Start HTTP API server
microservice-prompts mcp        Start MCP server
microservice-prompts status     Show connection status
```

## License

Apache-2.0
