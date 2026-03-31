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
  .option("--json", "Output as JSON")
  .option("--db <url>")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    const sql = getDb();
    try {
      const items = await listUserNotifications(sql, o.user, {
        limit: parseInt(o.limit, 10),
        unreadOnly: o.unreadOnly,
      });
      if (o.json) { console.log(JSON.stringify(items, null, 2)); return; }
      if (items.length === 0) { console.log("  (no notifications)"); return; }
      for (const n of items) {
        const read = n.read_at ? "✓" : "●";
        console.log(`  ${read} [${n.channel}] ${n.type} — ${n.title ?? n.body.slice(0, 60)}`);
      }
    } finally { await closeDb(); }
  });

program.command("test-send").description("Send a test notification to verify a channel is configured")
  .requiredOption("--channel <channel>", "Channel: email|sms|in_app|webhook")
  .option("--to <address>", "Target address (email address or user ID)")
  .option("--db <url>")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    const channel = o.channel as string;
    const to = o.to as string | undefined;
    console.log(`\nmicroservice-notify test-send — channel: ${channel}\n`);
    if (channel === "email") {
      const apiKey = process.env["RESEND_API_KEY"];
      const smtpHost = process.env["SMTP_HOST"];
      if (!apiKey && !smtpHost) {
        console.log("✗ Email not configured — set RESEND_API_KEY or SMTP_HOST");
        process.exit(1);
      }
      const target = to ?? "test@example.com";
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: process.env["NOTIFY_FROM_EMAIL"] ?? "notify@example.com",
            to: [target],
            subject: "microservice-notify test",
            text: "This is a test notification from microservice-notify.",
          }),
        });
        if (res.ok) {
          console.log(`✓ Test email sent successfully to ${target}`);
        } else {
          const text = await res.text();
          console.log(`✗ Resend API error ${res.status}: ${text}`);
          process.exit(1);
        }
      } catch (e) {
        console.log(`✗ Email delivery failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    } else if (channel === "sms") {
      const accountSid = process.env["TWILIO_ACCOUNT_SID"];
      if (!accountSid) {
        console.log("✗ SMS not configured — set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN");
        process.exit(1);
      }
      console.log("✓ Twilio SMS configured (TWILIO_ACCOUNT_SID present)");
    } else if (channel === "in_app") {
      console.log("✓ in_app channel is always available (stored in DB)");
    } else if (channel === "webhook") {
      console.log("✓ webhook channel is always available (triggers registered endpoints)");
    } else {
      console.log(`✗ Unknown channel: ${channel}`);
      process.exit(1);
    }
  });

program.parse();

program.command("init").description("Run migrations and confirm setup").requiredOption("--db <url>").action(async o => {
  process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); console.log("✓ microservice-notify ready\n  Schema: notify.*\n  Optional: RESEND_API_KEY, TWILIO_ACCOUNT_SID\n  Next: microservice-notify serve --port 3004"); } finally { await closeDb(); }
});

program.command("doctor").description("Check configuration and DB connectivity").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  let allOk = true;
  const check = (label: string, pass: boolean, hint?: string) => { console.log(`  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`); if (!pass) allOk = false; };
  console.log("\nmicroservice-notify doctor\n");
  check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");
  console.log(`  ℹ Email: ${process.env["RESEND_API_KEY"] ? "Resend ✓" : process.env["SMTP_HOST"] ? "SMTP ✓" : "not configured (in-app only)"}`);
  console.log(`  ℹ SMS: ${process.env["TWILIO_ACCOUNT_SID"] ? "Twilio ✓" : "not configured"}`);
  if (process.env["DATABASE_URL"]) {
    const sql = getDb();
    try {
      const start = Date.now(); await sql`SELECT 1`; check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'notify'`;
      check("Schema 'notify' exists", schemas.length > 0, "run: microservice-notify migrate");
    } catch (e) { check("PostgreSQL reachable", false, e instanceof Error ? e.message : String(e)); }
    finally { await closeDb(); }
  }
  console.log(`\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`);
  if (!allOk) process.exit(1);
});
