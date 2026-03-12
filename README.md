# @hasna/microservices

Mini business apps for AI agents. Each microservice has its own SQLite database, CLI, and MCP server.

## Install

```bash
bun install -g @hasna/microservices
```

## Setup MCP Server

Register with all AI coding agents in one command:

```bash
microservices mcp --register all
```

Or register individually:

```bash
microservices mcp --register claude    # Claude Code
microservices mcp --register codex     # Codex CLI
microservices mcp --register gemini    # Gemini CLI
```

**Manual setup** if you prefer:

<details>
<summary>Claude Code (~/.claude.json)</summary>

```json
{
  "mcpServers": {
    "microservices": {
      "type": "stdio",
      "command": "microservices-mcp",
      "args": [],
      "env": {}
    }
  }
}
```
</details>

<details>
<summary>Codex CLI (~/.codex/config.toml)</summary>

```toml
[mcp_servers.microservices]
command = "microservices-mcp"
```
</details>

<details>
<summary>Gemini CLI (~/.gemini/settings.json)</summary>

```json
{
  "mcpServers": {
    "microservices": {
      "command": "microservices-mcp",
      "args": []
    }
  }
}
```
</details>

## Quick Start

```bash
# Browse available microservices
microservices

# Install microservices
microservices install contacts invoices

# Run commands
microservices run contacts add --first-name "John" --last-name "Doe" --email "john@acme.com"
microservices run contacts list --json
microservices run invoices create --due 2026-04-01
microservices run invoices add-item --invoice INV-00001 --description "Consulting" --price 5000

# Check status
microservices status
```

## Available Microservices

| Name | Category | Description |
|------|----------|-------------|
| `contacts` | CRM | Contacts, companies, and relationships |
| `invoices` | Finance | Invoices with line items, clients, and payments |
| `bookkeeping` | Finance | Double-entry bookkeeping |
| `expenses` | Finance | Expense tracking and categorization |
| `crm` | CRM | Sales pipeline with stages, deals, and activities |
| `inventory` | Operations | Products, stock levels, and movements |
| `notes` | Productivity | Structured notes with tags and search |
| `calendar` | Productivity | Events, reminders, and scheduling |
| `documents` | Productivity | Document metadata and versioning |
| `timesheets` | HR | Time tracking per project and client |

## Architecture

```
.microservices/
├── microservice-contacts/
│   ├── data.db              # SQLite database (WAL mode)
│   └── src/                 # Service source code
│       ├── db/              # Database layer (CRUD + migrations)
│       ├── cli/             # CLI interface (Commander.js)
│       └── mcp/             # MCP server (per-service)
├── microservice-invoices/
│   ├── data.db
│   └── src/
└── ...
```

Each microservice:
- Has its **own SQLite database** — no shared state
- Exposes a **CLI** for direct use
- Exposes an **MCP server** for AI agents
- Manages its own **migrations**

## CLI Commands

```bash
microservices                          # Interactive TUI
microservices list                     # List all available
microservices list --installed         # List installed only
microservices search <query>           # Search by name/description
microservices install <names...>       # Install microservices
microservices remove <name>            # Remove (preserves data)
microservices info <name>              # Show details
microservices status                   # Show installed + DB sizes
microservices categories               # List categories
microservices run <name> [args...]     # Run a microservice command
microservices ops <name>               # Show available operations
```

## MCP Server

```bash
# Hub MCP (management)
microservices-mcp

# Per-service MCP (after install)
bun run .microservices/microservice-contacts/src/mcp/index.ts
bun run .microservices/microservice-invoices/src/mcp/index.ts
```

### Hub MCP Tools

| Tool | Description |
|------|-------------|
| `search_microservices` | Search by name or keyword |
| `list_microservices` | List with optional category filter |
| `list_categories` | Categories with counts |
| `microservice_info` | Metadata + install status + DB info |
| `install_microservice` | Install to .microservices/ |
| `remove_microservice` | Remove (data preserved by default) |
| `list_installed` | Installed services with status |
| `run_microservice` | Execute a command on a service |
| `list_microservice_operations` | Discover available commands |

## Library API

```typescript
import {
  MICROSERVICES,
  searchMicroservices,
  installMicroservice,
  runMicroserviceCommand,
} from "@hasna/microservices";

// Search
const results = searchMicroservices("finance");

// Install
installMicroservice("contacts");

// Run
const output = await runMicroserviceCommand("contacts", ["list", "--json"]);
```

## License

Apache-2.0
