# @hasna/microservice-guardrails

> Guardrails microservice — PII detection, prompt injection defense, toxicity filtering, policy enforcement — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-guardrails
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-guardrails migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-guardrails serve --port 3001

# Start the MCP server (for AI agents)
microservice-guardrails mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-guardrails'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GUARDRAILS_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-guardrails migrate    Run database migrations
microservice-guardrails serve      Start HTTP API server
microservice-guardrails mcp        Start MCP server
microservice-guardrails status     Show connection status
```

## License

Apache-2.0
