# @hasna/microservice-teams

> Teams microservice — workspaces, members, RBAC, invites, multi-tenancy — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-teams
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-teams migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-teams serve --port 3001

# Start the MCP server (for AI agents)
microservice-teams mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-teams'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `TEAMS_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-teams migrate    Run database migrations
microservice-teams serve      Start HTTP API server
microservice-teams mcp        Start MCP server
microservice-teams status     Show connection status
```

## License

Apache-2.0
