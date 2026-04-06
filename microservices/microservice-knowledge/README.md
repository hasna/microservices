# @hasna/microservice-knowledge

> Knowledge microservice — RAG collections, document ingestion, chunking, embeddings, semantic/text/hybrid retrieval — part of [@hasna/microservices](https://github.com/hasna/microservices)

## Install

```bash
bun install -g @hasna/microservice-knowledge
```

## Quick Start

```bash
# Run migrations against your PostgreSQL database
microservice-knowledge migrate --db postgres://localhost/myapp

# Start the HTTP API (standalone mode)
microservice-knowledge serve --port 3001

# Start the MCP server (for AI agents)
microservice-knowledge mcp
```

## Embedded Usage

```ts
import { migrate, getDb } from '@hasna/microservice-knowledge'

const sql = getDb('postgres://localhost/myapp')
await migrate(sql)

// Use core functions
// const record = await createRecord(sql, { ... })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `KNOWLEDGE_PORT` | No | HTTP server port (default: 3000) |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|

## CLI Commands

```
microservice-knowledge migrate    Run database migrations
microservice-knowledge serve      Start HTTP API server
microservice-knowledge mcp        Start MCP server
microservice-knowledge status     Show connection status
```

## License

Apache-2.0
