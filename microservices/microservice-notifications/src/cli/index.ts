#!/usr/bin/env bun

import { Command } from "commander";
import {
  sendNotification,
  listNotifications,
  getNotification,
  markRead,
  markAllRead,
  createRule,
  listRules,
  enableRule,
  disableRule,
  deleteRule,
  createTemplate,
  listTemplates,
  deleteTemplate,
  processEvent,
  getNotificationStats,
} from "../db/notifications.js";

const program = new Command();

program
  .name("microservice-notifications")
  .description("Notification management microservice")
  .version("0.0.1");

// --- Notifications ---

program
  .command("send")
  .description("Send a notification")
  .requiredOption("--channel <channel>", "Channel (email, slack, sms, webhook, in_app)")
  .requiredOption("--to <recipient>", "Recipient")
  .option("--subject <subject>", "Subject")
  .option("--body <body>", "Body")
  .option("--priority <priority>", "Priority (low, normal, high, urgent)", "normal")
  .option("--source-service <service>", "Source service")
  .option("--source-event <event>", "Source event")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const notification = sendNotification({
      channel: opts.channel,
      recipient: opts.to,
      subject: opts.subject,
      body: opts.body,
      priority: opts.priority,
      source_service: opts.sourceService,
      source_event: opts.sourceEvent,
    });

    if (opts.json) {
      console.log(JSON.stringify(notification, null, 2));
    } else {
      console.log(`Sent notification: ${notification.channel} -> ${notification.recipient} (${notification.id})`);
    }
  });

program
  .command("list")
  .description("List notifications")
  .option("--status <status>", "Filter by status (pending, sent, failed, read)")
  .option("--channel <channel>", "Filter by channel")
  .option("--priority <priority>", "Filter by priority")
  .option("--recipient <recipient>", "Filter by recipient")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const notifications = listNotifications({
      status: opts.status,
      channel: opts.channel,
      priority: opts.priority,
      recipient: opts.recipient,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(notifications, null, 2));
    } else {
      if (notifications.length === 0) {
        console.log("No notifications found.");
        return;
      }
      for (const n of notifications) {
        const subject = n.subject ? ` — ${n.subject}` : "";
        console.log(`  [${n.status}] ${n.channel} -> ${n.recipient}${subject} (${n.priority})`);
      }
      console.log(`\n${notifications.length} notification(s)`);
    }
  });

program
  .command("read")
  .description("Mark a notification as read")
  .argument("<id>", "Notification ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const notification = markRead(id);
    if (!notification) {
      console.error(`Notification '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(notification, null, 2));
    } else {
      console.log(`Marked as read: ${notification.id}`);
    }
  });

program
  .command("read-all")
  .description("Mark all notifications as read for a recipient")
  .requiredOption("--recipient <recipient>", "Recipient")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const count = markAllRead(opts.recipient);

    if (opts.json) {
      console.log(JSON.stringify({ recipient: opts.recipient, marked_read: count }));
    } else {
      console.log(`Marked ${count} notification(s) as read for ${opts.recipient}`);
    }
  });

// --- Rules ---

const ruleCmd = program
  .command("rule")
  .description("Notification rule management");

ruleCmd
  .command("create")
  .description("Create a notification rule")
  .requiredOption("--event <event>", "Trigger event")
  .requiredOption("--channel <channel>", "Notification channel")
  .requiredOption("--to <recipient>", "Recipient")
  .option("--name <name>", "Rule name")
  .option("--template <id>", "Template ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const rule = createRule({
      name: opts.name,
      trigger_event: opts.event,
      channel: opts.channel,
      recipient: opts.to,
      template_id: opts.template,
    });

    if (opts.json) {
      console.log(JSON.stringify(rule, null, 2));
    } else {
      console.log(`Created rule: ${rule.trigger_event} -> ${rule.channel}:${rule.recipient} (${rule.id})`);
    }
  });

ruleCmd
  .command("list")
  .description("List notification rules")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const rules = listRules();

    if (opts.json) {
      console.log(JSON.stringify(rules, null, 2));
    } else {
      if (rules.length === 0) {
        console.log("No rules found.");
        return;
      }
      for (const r of rules) {
        const name = r.name ? ` (${r.name})` : "";
        const status = r.enabled ? "enabled" : "disabled";
        console.log(`  [${status}] ${r.trigger_event} -> ${r.channel}:${r.recipient}${name}`);
      }
      console.log(`\n${rules.length} rule(s)`);
    }
  });

ruleCmd
  .command("enable")
  .description("Enable a rule")
  .argument("<id>", "Rule ID")
  .action((id) => {
    const rule = enableRule(id);
    if (!rule) {
      console.error(`Rule '${id}' not found.`);
      process.exit(1);
    }
    console.log(`Enabled rule ${id}`);
  });

ruleCmd
  .command("disable")
  .description("Disable a rule")
  .argument("<id>", "Rule ID")
  .action((id) => {
    const rule = disableRule(id);
    if (!rule) {
      console.error(`Rule '${id}' not found.`);
      process.exit(1);
    }
    console.log(`Disabled rule ${id}`);
  });

ruleCmd
  .command("delete")
  .description("Delete a rule")
  .argument("<id>", "Rule ID")
  .action((id) => {
    const deleted = deleteRule(id);
    if (deleted) {
      console.log(`Deleted rule ${id}`);
    } else {
      console.error(`Rule '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Templates ---

const templateCmd = program
  .command("template")
  .description("Notification template management");

templateCmd
  .command("create")
  .description("Create a notification template")
  .requiredOption("--name <name>", "Template name")
  .option("--channel <channel>", "Channel")
  .option("--subject <subject>", "Subject template")
  .option("--body <body>", "Body template")
  .option("--variables <vars>", "Comma-separated variable names")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const template = createTemplate({
      name: opts.name,
      channel: opts.channel,
      subject_template: opts.subject,
      body_template: opts.body,
      variables: opts.variables ? opts.variables.split(",").map((v: string) => v.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(template, null, 2));
    } else {
      console.log(`Created template: ${template.name} (${template.id})`);
    }
  });

templateCmd
  .command("list")
  .description("List notification templates")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const templates = listTemplates();

    if (opts.json) {
      console.log(JSON.stringify(templates, null, 2));
    } else {
      if (templates.length === 0) {
        console.log("No templates found.");
        return;
      }
      for (const t of templates) {
        const channel = t.channel ? ` [${t.channel}]` : "";
        console.log(`  ${t.name}${channel} (${t.id})`);
      }
      console.log(`\n${templates.length} template(s)`);
    }
  });

templateCmd
  .command("delete")
  .description("Delete a template")
  .argument("<id>", "Template ID")
  .action((id) => {
    const deleted = deleteTemplate(id);
    if (deleted) {
      console.log(`Deleted template ${id}`);
    } else {
      console.error(`Template '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Event Processing ---

program
  .command("process")
  .description("Process an event and trigger matching rules")
  .requiredOption("--event <event>", "Event name")
  .option("--data <json>", "Event data as JSON", "{}")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    let data: Record<string, string>;
    try {
      data = JSON.parse(opts.data);
    } catch {
      console.error("Invalid JSON data");
      process.exit(1);
    }

    const notifications = processEvent(opts.event, data);

    if (opts.json) {
      console.log(JSON.stringify(notifications, null, 2));
    } else {
      if (notifications.length === 0) {
        console.log(`No rules matched event '${opts.event}'.`);
        return;
      }
      console.log(`Processed event '${opts.event}' — created ${notifications.length} notification(s):`);
      for (const n of notifications) {
        console.log(`  ${n.channel} -> ${n.recipient}`);
      }
    }
  });

// --- Stats ---

program
  .command("stats")
  .description("Show notification statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getNotificationStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Total notifications: ${stats.total}`);
      console.log("\nBy channel:");
      for (const [channel, count] of Object.entries(stats.by_channel)) {
        console.log(`  ${channel}: ${count}`);
      }
      console.log("\nBy status:");
      for (const [status, count] of Object.entries(stats.by_status)) {
        console.log(`  ${status}: ${count}`);
      }
      console.log("\nBy priority:");
      for (const [priority, count] of Object.entries(stats.by_priority)) {
        console.log(`  ${priority}: ${count}`);
      }
    }
  });

program.parse(process.argv);
