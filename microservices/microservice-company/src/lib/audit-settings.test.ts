import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-company-audit-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  logAction,
  searchAudit,
  getAuditTimeline,
  getAuditStats,
  type AuditAction,
} from "./audit";
import {
  getSetting,
  setSetting,
  getAllSettings,
  deleteSetting,
  bulkSetSettings,
} from "./settings";
import { createOrg } from "../db/company";
import { closeDatabase } from "../db/database";

let orgId: string;

beforeAll(() => {
  const org = createOrg({ name: "Test Corp" });
  orgId = org.id;
});

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── Audit Log Tests ─────────────────────────────────────────────────────────

describe("audit - logAction", () => {
  test("logs a basic action", () => {
    const entry = logAction({
      org_id: orgId,
      actor: "agent-1",
      action: "create",
      service: "invoices",
      entity_type: "invoice",
      entity_id: "inv-001",
    });

    expect(entry.id).toBeTruthy();
    expect(entry.actor).toBe("agent-1");
    expect(entry.action).toBe("create");
    expect(entry.service).toBe("invoices");
    expect(entry.entity_type).toBe("invoice");
    expect(entry.entity_id).toBe("inv-001");
    expect(entry.timestamp).toBeTruthy();
  });

  test("logs with details", () => {
    const entry = logAction({
      org_id: orgId,
      actor: "agent-2",
      action: "update",
      service: "contacts",
      details: { field: "email", old: "a@b.com", new: "c@d.com" },
    });

    expect(entry.details.field).toBe("email");
    expect(entry.details.old).toBe("a@b.com");
  });

  test("logs without org_id", () => {
    const entry = logAction({
      actor: "system",
      action: "login",
    });

    expect(entry.org_id).toBeNull();
    expect(entry.actor).toBe("system");
    expect(entry.action).toBe("login");
  });
});

describe("audit - searchAudit", () => {
  test("returns all entries when no filters", () => {
    const results = searchAudit({});
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  test("filters by actor", () => {
    const results = searchAudit({ actor: "agent-1" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((e) => e.actor === "agent-1")).toBe(true);
  });

  test("filters by service", () => {
    const results = searchAudit({ service: "invoices" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((e) => e.service === "invoices")).toBe(true);
  });

  test("filters by action", () => {
    const results = searchAudit({ action: "create" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((e) => e.action === "create")).toBe(true);
  });

  test("respects limit", () => {
    const results = searchAudit({ limit: 1 });
    expect(results.length).toBe(1);
  });

  test("filters by org_id", () => {
    const results = searchAudit({ org_id: orgId });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((e) => e.org_id === orgId)).toBe(true);
  });
});

describe("audit - getAuditTimeline", () => {
  test("returns timeline for entity", () => {
    // Add a second action on same entity
    logAction({
      org_id: orgId,
      actor: "agent-1",
      action: "update",
      service: "invoices",
      entity_type: "invoice",
      entity_id: "inv-001",
      details: { status: "paid" },
    });

    const timeline = getAuditTimeline("invoice", "inv-001");
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline[0].action).toBe("create");
    expect(timeline[1].action).toBe("update");
  });

  test("returns empty for unknown entity", () => {
    const timeline = getAuditTimeline("invoice", "nonexistent");
    expect(timeline.length).toBe(0);
  });
});

describe("audit - getAuditStats", () => {
  test("returns correct stats", () => {
    const stats = getAuditStats(orgId);
    expect(stats.total).toBeGreaterThanOrEqual(3);
    expect(stats.by_actor["agent-1"]).toBeGreaterThanOrEqual(2);
    expect(stats.by_action["create"]).toBeGreaterThanOrEqual(1);
    expect(stats.by_service["invoices"]).toBeGreaterThanOrEqual(1);
  });

  test("returns stats without org filter", () => {
    const stats = getAuditStats();
    expect(stats.total).toBeGreaterThanOrEqual(4); // includes the login without org
  });
});

// ─── Settings Tests ──────────────────────────────────────────────────────────

describe("settings - setSetting / getSetting", () => {
  test("creates a new setting", () => {
    const setting = setSetting(orgId, "theme", "dark", "appearance");
    expect(setting.key).toBe("theme");
    expect(setting.value).toBe("dark");
    expect(setting.category).toBe("appearance");
    expect(setting.org_id).toBe(orgId);
  });

  test("retrieves a setting", () => {
    const setting = getSetting(orgId, "theme");
    expect(setting).not.toBeNull();
    expect(setting!.value).toBe("dark");
  });

  test("updates an existing setting (upsert)", () => {
    const updated = setSetting(orgId, "theme", "light", "appearance");
    expect(updated.value).toBe("light");

    const fetched = getSetting(orgId, "theme");
    expect(fetched!.value).toBe("light");
  });

  test("returns null for nonexistent setting", () => {
    const result = getSetting(orgId, "nonexistent-key");
    expect(result).toBeNull();
  });
});

describe("settings - getAllSettings", () => {
  test("lists all settings for org", () => {
    setSetting(orgId, "language", "en", "locale");
    setSetting(orgId, "timezone-display", "12h", "locale");

    const all = getAllSettings(orgId);
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("filters by category", () => {
    const localeSettings = getAllSettings(orgId, "locale");
    expect(localeSettings.length).toBe(2);
    expect(localeSettings.every((s) => s.category === "locale")).toBe(true);
  });
});

describe("settings - deleteSetting", () => {
  test("deletes an existing setting", () => {
    setSetting(orgId, "temp-key", "temp-value");
    const deleted = deleteSetting(orgId, "temp-key");
    expect(deleted).toBe(true);

    const fetched = getSetting(orgId, "temp-key");
    expect(fetched).toBeNull();
  });

  test("returns false for nonexistent setting", () => {
    const deleted = deleteSetting(orgId, "does-not-exist");
    expect(deleted).toBe(false);
  });
});

describe("settings - bulkSetSettings", () => {
  test("sets multiple settings at once", () => {
    const results = bulkSetSettings(orgId, [
      { key: "bulk-1", value: "val-1", category: "bulk" },
      { key: "bulk-2", value: "val-2", category: "bulk" },
      { key: "bulk-3", value: "val-3", category: "bulk" },
    ]);

    expect(results.length).toBe(3);
    expect(results[0].key).toBe("bulk-1");
    expect(results[2].value).toBe("val-3");

    const bulkSettings = getAllSettings(orgId, "bulk");
    expect(bulkSettings.length).toBe(3);
  });
});
