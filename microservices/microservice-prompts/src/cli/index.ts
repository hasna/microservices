#!/usr/bin/env bun
import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { createPrompt, getPrompt, listPrompts } from "../lib/prompts_crud.js";
import { resolvePrompt } from "../lib/resolve.js";
import {
  diffVersions,
  getVersion,
  rollback,
  updatePrompt,
} from "../lib/versions.js";

const program = new Command();
program
  .name("microservice-prompts")
  .description(
    "Prompts microservice — versioned prompts, overrides, experiments, variable interpolation",
  )
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
      console.log("✓ prompts schema migrations complete");
    } finally {
      await closeDb();
    }
  });

program
  .command("serve")
  .option("--port <n>", "Port", String(process.env.PROMPTS_PORT ?? "3021"))
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    await startServer(parseInt(o.port, 10));
  });

program
  .command("mcp")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    await import("../mcp/index.js");
  });

program
  .command("list")
  .description("List prompts")
  .requiredOption("--workspace <id>", "Workspace ID")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const tags = o.tags?.split(",").filter(Boolean);
      const prompts = await listPrompts(sql, o.workspace, { tags });
      if (o.json) {
        console.log(JSON.stringify(prompts, null, 2));
      } else {
        for (const p of prompts)
          console.log(
            `  ${p.name.padEnd(30)} v${p.version_number ?? "?"}  ${(p.tags ?? []).join(", ")}`,
          );
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("get")
  .description("Get a prompt by name")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--name <name>", "Prompt name")
  .option("--json", "Output as JSON")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const prompt = await getPrompt(sql, o.workspace, o.name);
      if (!prompt) {
        console.error("✗ Prompt not found");
        process.exit(1);
      }
      if (o.json) {
        console.log(JSON.stringify(prompt, null, 2));
      } else {
        console.log(
          `${prompt.name} (v${prompt.version_number})\n---\n${prompt.content}`,
        );
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("create")
  .description("Create a new prompt")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--name <name>", "Prompt name")
  .requiredOption("--content <content>", "Prompt content")
  .option("--description <desc>")
  .option("--model <model>")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const tags = o.tags?.split(",").filter(Boolean);
      const p = await createPrompt(sql, {
        workspaceId: o.workspace,
        name: o.name,
        content: o.content,
        description: o.description,
        model: o.model,
        tags,
      });
      console.log("✓ Created:", p.id, p.name);
    } finally {
      await closeDb();
    }
  });

program
  .command("update <prompt-id>")
  .description("Create a new version of a prompt")
  .requiredOption("--content <content>", "New content")
  .option("--note <note>", "Change note")
  .option("--db <url>")
  .action(async (promptId, o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const v = await updatePrompt(sql, promptId, {
        content: o.content,
        changeNote: o.note,
      });
      console.log(
        `✓ Created version ${v.version_number} for prompt ${promptId}`,
      );
    } finally {
      await closeDb();
    }
  });

program
  .command("rollback <prompt-id>")
  .description("Rollback prompt to a specific version")
  .requiredOption("--to-version <n>", "Version number")
  .option("--db <url>")
  .action(async (promptId, o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      await rollback(sql, promptId, parseInt(o.toVersion, 10));
      console.log(`✓ Rolled back prompt ${promptId} to version ${o.toVersion}`);
    } finally {
      await closeDb();
    }
  });

program
  .command("diff <prompt-id>")
  .description("Diff two versions of a prompt")
  .requiredOption("--v1 <n>", "First version number")
  .requiredOption("--v2 <n>", "Second version number")
  .option("--db <url>")
  .action(async (promptId, o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const ver1 = await getVersion(sql, promptId, parseInt(o.v1, 10));
      const ver2 = await getVersion(sql, promptId, parseInt(o.v2, 10));
      if (!ver1 || !ver2) {
        console.error("✗ Version not found");
        process.exit(1);
      }
      const result = diffVersions(promptId, ver1.content, ver2.content);
      for (const line of result.removed) console.log(`- ${line}`);
      for (const line of result.added) console.log(`+ ${line}`);
      for (const line of result.unchanged) console.log(`  ${line}`);
    } finally {
      await closeDb();
    }
  });

program
  .command("resolve")
  .description("Resolve a prompt with context")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--name <name>", "Prompt name")
  .option("--user <id>", "User ID")
  .option("--variables-json <json>", "Variables as JSON object")
  .option("--json", "Output as JSON")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const variables = o.variablesJson
        ? JSON.parse(o.variablesJson)
        : undefined;
      const result = await resolvePrompt(sql, o.workspace, o.name, {
        userId: o.user,
        variables,
      });
      if (o.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          `source: ${result.source}${result.version_number ? ` (v${result.version_number})` : ""}\n---\n${result.content}`,
        );
      }
    } finally {
      await closeDb();
    }
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
        "✓ microservice-prompts ready\n  Schema: prompts.*\n  Next: microservice-prompts serve --port 3021",
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
    console.log("\nmicroservice-prompts doctor\n");
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
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'prompts'`;
        check(
          "Schema 'prompts' exists",
          schemas.length > 0,
          "run: microservice-prompts migrate",
        );
        if (schemas.length > 0) {
          const tables =
            await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'prompts' ORDER BY table_name`;
          check(
            `Tables (${tables.length})`,
            tables.length >= 5,
            tables.map((t: any) => t.table_name).join(", "),
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

program.parse();
