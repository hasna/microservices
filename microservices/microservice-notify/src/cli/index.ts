#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { sendNotification } from "../lib/send.js";
import { listUserNotifications } from "../lib/notifications.js";

const program = new Command();
program.name("microservice-notify").description("Notify microservice — notifications, preferences, templates, webhooks").version("0.0.1");

program.command("migrate").description("Run migrations").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb();
  try { await migrate(sql); console.log("✓ notify schema migrations complete"); } finally { await closeDb(); }
});

program.command("serve").description("Start HTTP server").option("--port <n>", "Port", String(process.env["NOTIFY_PORT"] ?? "3004")).option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  await startServer(parseInt(o.port, 10));
});

program.command("mcp").description("Start MCP server").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  await import("../mcp/index.js");
});

program.command("status").description("Connection and schema status").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb();
  try {
    const [{ version }] = await sql`SELECT version()`;
    console.log("✓ PostgreSQL:", version.split(" ").slice(0, 2).join(" "));
    const s = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'notify'`;
    console.log("  Schema 'notify':", s.length > 0 ? "✓" : "✗ (run migrate)");
  } finally { await closeDb(); }
});

program.command("send").description("Send a notification")
  .requiredOption("--user <id>", "User ID")
  .requiredOption("--channel <channel>", "Channel: email|sms|in_app|webhook")
  .requiredOption("--type <type>", "Notification type")
  .requiredOption("--body <body>", "Notification body")
  .option("--title <title>", "Optional title")
  .option("--workspace <id>", "Optional workspace ID")
  .option("--db <url>")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      await sendNotification(sql, {
        userId: o.user,
        workspaceId: o.workspace,
        channel: o.channel,
        type: o.type,
        title: o.title,
        body: o.body,
      });
      console.log("✓ Notification sent");
    } finally { await closeDb(); }
  });

program.command("list-notifications").description("List notifications for a user")
  .requiredOption("--user <id>", "User ID")
  .option("--limit <n>", "Limit", "20")
  .option("--unread-only", "Show only unread")
  .option("--db <url>")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    const sql = getDb();
    try {
      const items = await listUserNotifications(sql, o.user, {
        limit: parseInt(o.limit, 10),
        unreadOnly: o.unreadOnly,
      });
      if (items.length === 0) { console.log("  (no notifications)"); return; }
      for (const n of items) {
        const read = n.read_at ? "✓" : "●";
        console.log(`  ${read} [${n.channel}] ${n.type} — ${n.title ?? n.body.slice(0, 60)}`);
      }
    } finally { await closeDb(); }
  });

program.parse();
