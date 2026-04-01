# Contributing to @hasna/microservices

Thank you for your interest in contributing to **open-microservices**! We welcome all contributions, including bug reports, feature requests, documentation improvements, and code submissions.

## Monorepo Architecture

This project is a monorepo managed by [Bun Workspaces](https://bun.sh/docs/install/workspaces). Each microservice acts as an independent NPM package within the `microservices/` directory but shares the root dependency tree.

### Key Tools
- **Bun**: Fast all-in-one JavaScript runtime, bundler, test runner, and package manager.
- **PostgreSQL**: Primary data store for all microservices. Some services (`knowledge`, `memory`) explicitly require the `pgvector` extension.
- **TypeScript**: Used strictly across all packages.
- **MCP (Model Context Protocol)**: Exposes features directly to AI Agents.

## Development Setup

1. **Prerequisites:**
   - Install [Bun](https://bun.sh/) (v1.0 or higher)
   - Install [Docker](https://www.docker.com/) (for PostgreSQL)

2. **Clone and Install:**
   ```bash
   git clone https://github.com/hasna/microservices.git
   cd microservices
   bun install
   ```

3. **Start the Database:**
   We provide a standard `docker-compose.yml` preconfigured with PostgreSQL + `pgvector`.
   ```bash
   docker-compose up -d
   ```

4. **Verify Everything:**
   ```bash
   # Run all database migrations
   bun run dev migrate-all
   
   # Run the full test suite
   bun run test:all
   ```

## Adding a New Microservice

Instead of manually duplicating code, we provide a unified scaffolding CLI to build new services quickly:

```bash
bun run dev scaffold <name-of-your-service>
```

This will automatically:
- Copy the `_template` structure into `microservices/microservice-<name>`.
- Replace all placeholder variables internally and safely format `.ts` files.

**After Scaffolding:**
1. Update `src/lib/registry.ts` to include the metadata for your new service.
2. Re-run `bun install` to ensure the new workspace package is linked in `node_modules`.
3. Start implementing your schema inside `src/db/migrations.ts` and core logic inside `src/lib/`.
4. Expose the functionality to the MCP agent layer in `src/mcp/index.ts`.

## Code Guidelines

- **Embed-First:** Our microservices function primarily as robust libraries. Always build your raw operations within `src/lib/` making sure they directly accept a Postgres `sql` instance rather than hardcoding HTTP state into the logic.
- **Standalone Mode:** Provide thin wrappers around your `lib` operations inside `src/http/routes.ts`.
- **Database Schema isolation:** Every single microservice **MUST** use its own schema prefix. If you are building the `tasks` service, ensure all tables are named `tasks.*` (e.g. `tasks.records`).
- **Run Tests:** Ensure you provide test coverage. Use `bun test` to execute them.

## Pull Requests
- Keep PRs scoped to a single fix or feature.
- Ensure that `bun run test:all` and `bun run build:all` complete successfully before opening a pull request.
- Add descriptive summaries and commit messages.

We appreciate your effort in making this project better!
