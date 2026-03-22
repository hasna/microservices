import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-notifications-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  sendNotification,
  getNotification,
  listNotifications,
  markRead,
  markAllRead,
  markSent,
  markFailed,
  createRule,
  getRule,
  listRules,
  updateRule,
  deleteRule,
  enableRule,
  disableRule,
  createTemplate,
  getTemplate,
  listTemplates,
  deleteTemplate,
  renderTemplate,
  processEvent,
  getNotificationStats,
} from "./notifications";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── Notifications ───────────────────────────────────────────────────────────

describe("Notifications", () => {
  test("send and get notification", () => {
    const n = sendNotification({
      channel: "email",
      recipient: "alice@example.com",
      subject: "Hello",
      body: "Welcome!",
    });

    expect(n.id).toBeTruthy();
    expect(n.channel).toBe("email");
    expect(n.recipient).toBe("alice@example.com");
    expect(n.subject).toBe("Hello");
    expect(n.body).toBe("Welcome!");
    expect(n.status).toBe("pending");
    expect(n.priority).toBe("normal");

    const fetched = getNotification(n.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(n.id);
  });

  test("send notification with priority and source", () => {
    const n = sendNotification({
      channel: "slack",
      recipient: "#general",
      subject: "Alert",
      body: "Server down",
      priority: "urgent",
      source_service: "monitoring",
      source_event: "server.down",
    });

    expect(n.priority).toBe("urgent");
    expect(n.source_service).toBe("monitoring");
    expect(n.source_event).toBe("server.down");
  });

  test("send notification with metadata", () => {
    const n = sendNotification({
      channel: "webhook",
      recipient: "https://hook.example.com",
      metadata: { key: "value", count: 42 },
    });

    expect(n.metadata).toEqual({ key: "value", count: 42 });
  });

  test("get non-existent notification returns null", () => {
    expect(getNotification("non-existent-id")).toBeNull();
  });

  test("list notifications", () => {
    const all = listNotifications();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list notifications with status filter", () => {
    const pending = listNotifications({ status: "pending" });
    expect(pending.length).toBeGreaterThanOrEqual(3);
    expect(pending.every((n) => n.status === "pending")).toBe(true);
  });

  test("list notifications with channel filter", () => {
    const emails = listNotifications({ channel: "email" });
    expect(emails.length).toBeGreaterThanOrEqual(1);
    expect(emails.every((n) => n.channel === "email")).toBe(true);
  });

  test("list notifications with priority filter", () => {
    const urgent = listNotifications({ priority: "urgent" });
    expect(urgent.length).toBeGreaterThanOrEqual(1);
    expect(urgent.every((n) => n.priority === "urgent")).toBe(true);
  });

  test("list notifications with limit", () => {
    const limited = listNotifications({ limit: 2 });
    expect(limited.length).toBe(2);
  });

  test("mark notification as read", () => {
    const n = sendNotification({
      channel: "in_app",
      recipient: "user1",
      subject: "Read me",
    });

    const read = markRead(n.id);
    expect(read).toBeDefined();
    expect(read!.status).toBe("read");
  });

  test("mark non-existent notification as read returns null", () => {
    expect(markRead("non-existent")).toBeNull();
  });

  test("mark all as read for recipient", () => {
    sendNotification({ channel: "in_app", recipient: "bulk-user", subject: "msg1" });
    sendNotification({ channel: "in_app", recipient: "bulk-user", subject: "msg2" });
    sendNotification({ channel: "in_app", recipient: "bulk-user", subject: "msg3" });

    const count = markAllRead("bulk-user");
    expect(count).toBe(3);

    const remaining = listNotifications({ recipient: "bulk-user", status: "pending" });
    expect(remaining.length).toBe(0);
  });

  test("mark notification as sent", () => {
    const n = sendNotification({
      channel: "sms",
      recipient: "+1234567890",
      body: "OTP: 123456",
    });

    const sent = markSent(n.id);
    expect(sent).toBeDefined();
    expect(sent!.status).toBe("sent");
    expect(sent!.sent_at).toBeTruthy();
  });

  test("mark notification as failed", () => {
    const n = sendNotification({
      channel: "email",
      recipient: "bad@example.com",
      subject: "Will fail",
    });

    const failed = markFailed(n.id);
    expect(failed).toBeDefined();
    expect(failed!.status).toBe("failed");
  });
});

// ─── Rules ───────────────────────────────────────────────────────────────────

describe("Rules", () => {
  test("create and get rule", () => {
    const rule = createRule({
      name: "Deal Won Alert",
      trigger_event: "deal.won",
      channel: "email",
      recipient: "sales@example.com",
    });

    expect(rule.id).toBeTruthy();
    expect(rule.name).toBe("Deal Won Alert");
    expect(rule.trigger_event).toBe("deal.won");
    expect(rule.channel).toBe("email");
    expect(rule.recipient).toBe("sales@example.com");
    expect(rule.enabled).toBe(true);

    const fetched = getRule(rule.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(rule.id);
  });

  test("list rules", () => {
    const rules = listRules();
    expect(rules.length).toBeGreaterThanOrEqual(1);
  });

  test("update rule", () => {
    const rule = createRule({
      trigger_event: "invoice.created",
      channel: "slack",
      recipient: "#billing",
    });

    const updated = updateRule(rule.id, {
      name: "Invoice Notification",
      recipient: "#finance",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Invoice Notification");
    expect(updated!.recipient).toBe("#finance");
  });

  test("update non-existent rule returns null", () => {
    expect(updateRule("non-existent", { name: "nope" })).toBeNull();
  });

  test("disable and enable rule", () => {
    const rule = createRule({
      trigger_event: "test.toggle",
      channel: "email",
      recipient: "test@example.com",
    });

    const disabled = disableRule(rule.id);
    expect(disabled!.enabled).toBe(false);

    const enabled = enableRule(rule.id);
    expect(enabled!.enabled).toBe(true);
  });

  test("delete rule", () => {
    const rule = createRule({
      trigger_event: "test.delete",
      channel: "sms",
      recipient: "+1234567890",
    });

    expect(deleteRule(rule.id)).toBe(true);
    expect(getRule(rule.id)).toBeNull();
  });

  test("delete non-existent rule returns false", () => {
    expect(deleteRule("non-existent")).toBe(false);
  });
});

// ─── Templates ───────────────────────────────────────────────────────────────

describe("Templates", () => {
  test("create and get template", () => {
    const template = createTemplate({
      name: "Welcome Email",
      channel: "email",
      subject_template: "Welcome, {{name}}!",
      body_template: "Hello {{name}}, welcome to {{company}}.",
      variables: ["name", "company"],
    });

    expect(template.id).toBeTruthy();
    expect(template.name).toBe("Welcome Email");
    expect(template.channel).toBe("email");
    expect(template.subject_template).toBe("Welcome, {{name}}!");
    expect(template.variables).toEqual(["name", "company"]);

    const fetched = getTemplate(template.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Welcome Email");
  });

  test("list templates", () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(1);
  });

  test("render template with variable substitution", () => {
    const template = createTemplate({
      name: "Order Confirmation",
      subject_template: "Order #{{order_id}} confirmed",
      body_template: "Dear {{customer}}, your order #{{order_id}} for ${{amount}} is confirmed.",
      variables: ["order_id", "customer", "amount"],
    });

    const rendered = renderTemplate(template.id, {
      order_id: "12345",
      customer: "Alice",
      amount: "99.99",
    });

    expect(rendered).toBeDefined();
    expect(rendered!.subject).toBe("Order #12345 confirmed");
    expect(rendered!.body).toBe("Dear Alice, your order #12345 for $99.99 is confirmed.");
  });

  test("render template keeps unmatched variables as-is", () => {
    const template = createTemplate({
      name: "Partial",
      subject_template: "Hi {{name}}, from {{missing}}",
    });

    const rendered = renderTemplate(template.id, { name: "Bob" });
    expect(rendered!.subject).toBe("Hi Bob, from {{missing}}");
  });

  test("render non-existent template returns null", () => {
    expect(renderTemplate("non-existent", {})).toBeNull();
  });

  test("delete template", () => {
    const template = createTemplate({ name: "DeleteMe" });
    expect(deleteTemplate(template.id)).toBe(true);
    expect(getTemplate(template.id)).toBeNull();
  });

  test("delete non-existent template returns false", () => {
    expect(deleteTemplate("non-existent")).toBe(false);
  });
});

// ─── Event Processing ────────────────────────────────────────────────────────

describe("Event Processing", () => {
  test("process event matches rules and creates notifications", () => {
    createRule({
      name: "Deal Closed Email",
      trigger_event: "deal.closed",
      channel: "email",
      recipient: "manager@example.com",
    });

    createRule({
      name: "Deal Closed Slack",
      trigger_event: "deal.closed",
      channel: "slack",
      recipient: "#sales",
    });

    const notifications = processEvent("deal.closed", { deal_name: "Big Deal" });
    expect(notifications.length).toBe(2);
    expect(notifications.every((n) => n.source_event === "deal.closed")).toBe(true);
  });

  test("process event with template substitution", () => {
    const template = createTemplate({
      name: "Deal Template",
      subject_template: "Deal {{deal_name}} won!",
      body_template: "Congratulations! Deal {{deal_name}} worth ${{amount}} was won.",
      variables: ["deal_name", "amount"],
    });

    createRule({
      name: "Deal Won Template Rule",
      trigger_event: "deal.won.templated",
      channel: "email",
      recipient: "team@example.com",
      template_id: template.id,
    });

    const notifications = processEvent("deal.won.templated", {
      deal_name: "Enterprise",
      amount: "50000",
    });

    expect(notifications.length).toBe(1);
    expect(notifications[0].subject).toBe("Deal Enterprise won!");
    expect(notifications[0].body).toBe(
      "Congratulations! Deal Enterprise worth $50000 was won."
    );
  });

  test("process event with no matching rules returns empty", () => {
    const notifications = processEvent("no.such.event");
    expect(notifications.length).toBe(0);
  });

  test("disabled rules are not triggered", () => {
    const rule = createRule({
      trigger_event: "disabled.test",
      channel: "email",
      recipient: "test@example.com",
    });

    disableRule(rule.id);

    const notifications = processEvent("disabled.test");
    expect(notifications.length).toBe(0);
  });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

describe("Stats", () => {
  test("get notification stats", () => {
    const stats = getNotificationStats();

    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(typeof stats.by_channel).toBe("object");
    expect(typeof stats.by_status).toBe("object");
    expect(typeof stats.by_priority).toBe("object");
  });
});
