#!/usr/bin/env bun
import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { getAgentHealth } from "../lib/health.js";
import { sendMessage } from "../lib/messaging.js";
import { listAgents, registerAgent } from "../lib/registry.js";

const program = new Command();
program
  .name("microservice-agents")
  .description("Agents microservice — registry, messaging, tasks, routing")
  .version("0.0.1");

program
  .command("migrate")
  .description("Run migrations")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ agents schema migrations complete");
    } finally {
      await closeDb();
    }
  });

program
  .command("serve")
  .description("Start HTTP server")
  .option("--port <n>", "Port", String(process.env.AGENTS_PORT ?? "3020"))
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    await startServer(parseInt(o.port, 10));
  });

program
  .command("mcp")
  .description("Start MCP server")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    await import("../mcp/index.js");
  });

program
  .command("init")
  .description("Run migrations and confirm setup")
  .requiredOption("--db <url>")
  .action(async (o) => {
    process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log(
        "✓ microservice-agents ready\n  Schema: agents.*\n  Next: microservice-agents serve --port 3020",
      );
    } finally {
      await closeDb();
    }
  });

program
  .command("doctor")
  .description("Check configuration and DB connectivity")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    let allOk = true;
    const check = (label: string, pass: boolean, hint?: string) => {
      console.log(
        `  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`,
      );
      if (!pass) allOk = false;
    };
    console.log("\nmicroservice-agents doctor\n");
    check(
      "DATABASE_URL",
      !!process.env.DATABASE_URL,
      "set DATABASE_URL=postgres://...",
    );
    if (process.env.DATABASE_URL) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
        const schemas =
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'agents'`;
        check(
          "Schema 'agents' exists",
          schemas.length > 0,
          "run: microservice-agents migrate",
        );
        if (schemas.length > 0) {
          const tables =
            await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'agents' ORDER BY table_name`;
          check(
            `Tables (${tables.length})`,
            tables.length >= 3,
            tables.map((t) => t.table_name).join(", "),
          );
        }
      } catch (e) {
        check(
          "PostgreSQL reachable",
          false,
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        await closeDb();
      }
    }
    console.log(
      `\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`,
    );
    if (!allOk) process.exit(1);
  });

program
  .command("list")
  .description("List agents in a workspace")
  .requiredOption("--workspace <id>")
  .option("--status <s>")
  .option("--json", "Output as JSON")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const agents = await listAgents(sql, o.workspace, { status: o.status });
      if (o.json) {
        console.log(JSON.stringify(agents, null, 2));
      } else {
        for (const a of agents)
          console.log(
            `  ${a.id}  ${a.name}  ${a.status}  load=${a.current_load}/${a.max_concurrent}`,
          );
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("register")
  .description("Register a new agent")
  .requiredOption("--workspace <id>")
  .requiredOption("--name <n>")
  .option("--capabilities <caps>", "Comma-separated capabilities")
  .option("--model <m>")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const caps = o.capabilities
        ? o.capabilities.split(",").map((c: string) => c.trim())
        : undefined;
      const agent = await registerAgent(sql, {
        workspaceId: o.workspace,
        name: o.name,
        capabilities: caps,
        model: o.model,
      });
      console.log(
        "✓ Registered:",
        agent.id,
        agent.name,
        `[${agent.capabilities.join(", ")}]`,
      );
    } finally {
      await closeDb();
    }
  });

program
  .command("health")
  .description("Get agent health report")
  .requiredOption("--workspace <id>")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const h = await getAgentHealth(sql, o.workspace);
      console.log(
        `  total=${h.total}  active=${h.active}  idle=${h.idle}  stopped=${h.stopped}  error=${h.error}`,
      );
    } finally {
      await closeDb();
    }
  });

program
  .command("send-message")
  .description("Send a message between agents")
  .requiredOption("--from <id>")
  .requiredOption("--to <id>")
  .requiredOption("--type <t>")
  .requiredOption("--payload-json <json>")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const payload = JSON.parse(o.payloadJson);
      // Look up the from agent to get workspace_id
      const [fromAgent] = await sql<
        [{ workspace_id: string }]
      >`SELECT workspace_id FROM agents.agents WHERE id = ${o.from}`;
      if (!fromAgent) {
        console.error("✗ From agent not found");
        process.exit(1);
      }
      const msg = await sendMessage(sql, {
        workspaceId: fromAgent.workspace_id,
        fromAgentId: o.from,
        toAgentId: o.to,
        type: o.type,
        payload,
      });
      console.log("✓ Message sent:", msg.id);
    } finally {
      await closeDb();
    }
  });

program.parse();
