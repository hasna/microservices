#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { listFiles, countFiles, createFileRecord, getStorageStats } from "../lib/files.js";
import { upload, getMimeType, getStorageBackend } from "../lib/storage.js";
import { readFile } from "fs/promises";
import { basename } from "path";

const program = new Command();

program
  .name("microservice-files")
  .description("Files microservice — upload, manage, and serve files with S3 and local storage")
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates files.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ files schema migrations complete");
    } finally { await closeDb(); }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env["FILES_PORT"] ?? "3005"))
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    await startServer(parseInt(opts.port, 10));
  });

program
  .command("mcp")
  .description("Start the MCP server (stdio)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    await import("../mcp/index.js");
  });

program
  .command("status")
  .description("Show connection and schema status")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      const [{ version }] = await sql`SELECT version()`;
      console.log("✓ PostgreSQL:", version.split(" ").slice(0, 2).join(" "));
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'files'`;
      console.log("  Schema 'files':", schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)");
      console.log("  Storage backend:", getStorageBackend());
      if (schemas.length > 0) {
        const [{ count }] = await sql`SELECT COUNT(*) as count FROM files.files WHERE deleted_at IS NULL`;
        console.log("  Active files:", count);
      }
    } catch (err) {
      console.error("✗ Connection failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally { await closeDb(); }
  });

program
  .command("list-files")
  .description("List files for a workspace")
  .requiredOption("--workspace <id>", "Workspace ID")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      const [files, total] = await Promise.all([
        listFiles(sql, opts.workspace, { limit: parseInt(opts.limit, 10) }),
        countFiles(sql, opts.workspace),
      ]);
      if (opts.json) {
        console.log(JSON.stringify({ data: files, count: files.length, total }, null, 2));
        return;
      }
      console.log(`Files in workspace ${opts.workspace} (${total} total):`);
      for (const f of files) {
        const size = f.size_bytes >= 1024 * 1024
          ? `${(f.size_bytes / 1024 / 1024).toFixed(1)} MB`
          : `${(f.size_bytes / 1024).toFixed(1)} KB`;
        console.log(`  ${f.id}  ${f.name}  ${f.mime_type}  ${size}  ${f.storage}  ${f.access}`);
      }
    } finally { await closeDb(); }
  });

program
  .command("upload")
  .description("Upload a file to storage and record it in the database")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--path <path>", "Local file path to upload")
  .option("--name <name>", "Display name for the file (defaults to filename)")
  .option("--access <access>", "Access level: public, private, or signed", "private")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);

      const data = await readFile(opts.path);
      if (data.byteLength === 0) {
        console.error("✗ File is empty (0 bytes)");
        process.exit(1);
      }

      const originalName = basename(opts.path);
      const mimeType = getMimeType(originalName);
      const timestamp = Date.now();
      const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storageKey = `${opts.workspace}/${timestamp}_${safeName}`;

      console.log(`  Uploading to ${getStorageBackend()} backend...`);
      await upload(storageKey, data, mimeType);

      const record = await createFileRecord(sql, {
        workspace_id: opts.workspace,
        name: opts.name ?? originalName,
        original_name: originalName,
        mime_type: mimeType,
        size_bytes: data.byteLength,
        storage: getStorageBackend(),
        storage_key: storageKey,
        access: opts.access as "public" | "private" | "signed",
      });

      console.log(`✓ Uploaded file: ${record.id}`);
      console.log(`  Name: ${record.name}`);
      console.log(`  Size: ${record.size_bytes} bytes`);
      console.log(`  Storage key: ${record.storage_key}`);
    } finally { await closeDb(); }
  });

program
  .command("stats")
  .description("Show storage statistics for a workspace")
  .requiredOption("--workspace <id>", "Workspace ID")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      const stats = await getStorageStats(sql, opts.workspace);
      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      const mb = (stats.total_bytes / 1024 / 1024).toFixed(2);
      console.log(`Storage stats for workspace ${opts.workspace}:`);
      console.log(`  Total files: ${stats.total_files}`);
      console.log(`  Total size:  ${mb} MB (${stats.total_bytes} bytes)`);
      if (stats.by_mime_type.length > 0) {
        console.log("  By MIME type:");
        for (const entry of stats.by_mime_type) {
          const entryMb = (entry.bytes / 1024 / 1024).toFixed(2);
          console.log(`    ${entry.mime_type}: ${entry.count} files, ${entryMb} MB`);
        }
      }
    } finally { await closeDb(); }
  });

program.parse();

program.command("init").description("Run migrations and confirm setup").requiredOption("--db <url>").action(async o => {
  process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); console.log("✓ microservice-files ready\n  Schema: files.*\n  Optional: S3_BUCKET (falls back to local storage)\n  Next: microservice-files serve --port 3005"); } finally { await closeDb(); }
});

program.command("doctor").description("Check configuration and DB connectivity").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  let allOk = true;
  const check = (label: string, pass: boolean, hint?: string) => { console.log(`  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`); if (!pass) allOk = false; };
  console.log("\nmicroservice-files doctor\n");
  check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");
  const s3 = !!process.env["S3_BUCKET"];
  console.log(`  ℹ Storage: ${s3 ? `S3 (bucket: ${process.env["S3_BUCKET"]})` : "local (~/.hasna/files/uploads/)"}`);
  if (s3) {
    check("AWS_ACCESS_KEY_ID", !!process.env["AWS_ACCESS_KEY_ID"], "required for S3");
    check("AWS_SECRET_ACCESS_KEY", !!process.env["AWS_SECRET_ACCESS_KEY"], "required for S3");
  }
  if (process.env["DATABASE_URL"]) {
    const sql = getDb();
    try {
      const start = Date.now(); await sql`SELECT 1`; check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'files'`;
      check("Schema 'files' exists", schemas.length > 0, "run: microservice-files migrate");
    } catch (e) { check("PostgreSQL reachable", false, e instanceof Error ? e.message : String(e)); }
    finally { await closeDb(); }
  }
  console.log(`\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`);
  if (!allOk) process.exit(1);
});
