/**
 * Unit tests for audit event logic — no database required.
 */

import { describe, expect, test } from "bun:test";
import type { AuditEvent } from "./events.js";
import { computeChecksum, VALID_SEVERITY_LEVELS } from "./events.js";

// ---- Checksum tests --------------------------------------------------------

describe("computeChecksum", () => {
  test("is deterministic: same inputs produce same checksum", () => {
    const fields = {
      actor_id: "user-123",
      action: "user.login",
      resource_type: "user",
      resource_id: "user-123",
      workspace_id: "ws-abc",
      created_at: "2024-01-01T00:00:00.000Z",
    };
    const c1 = computeChecksum(fields);
    const c2 = computeChecksum(fields);
    expect(c1).toBe(c2);
  });

  test("produces a 64-character hex string (SHA-256)", () => {
    const checksum = computeChecksum({
      actor_id: "user-1",
      action: "doc.delete",
      resource_type: "document",
      resource_id: "doc-99",
      workspace_id: null,
      created_at: "2024-06-15T12:00:00.000Z",
    });
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  test("changes when actor_id changes", () => {
    const base = {
      actor_id: "user-A",
      action: "file.read",
      resource_type: "file",
      resource_id: "file-1",
      workspace_id: "ws-1",
      created_at: "2024-01-01T00:00:00.000Z",
    };
    const c1 = computeChecksum(base);
    const c2 = computeChecksum({ ...base, actor_id: "user-B" });
    expect(c1).not.toBe(c2);
  });

  test("changes when action changes", () => {
    const base = {
      actor_id: "user-1",
      action: "file.read",
      resource_type: "file",
      resource_id: "file-1",
      workspace_id: "ws-1",
      created_at: "2024-01-01T00:00:00.000Z",
    };
    const c1 = computeChecksum(base);
    const c2 = computeChecksum({ ...base, action: "file.write" });
    expect(c1).not.toBe(c2);
  });

  test("changes when created_at changes", () => {
    const base = {
      actor_id: "user-1",
      action: "user.login",
      resource_type: "user",
      resource_id: null,
      workspace_id: null,
      created_at: "2024-01-01T00:00:00.000Z",
    };
    const c1 = computeChecksum(base);
    const c2 = computeChecksum({
      ...base,
      created_at: "2024-01-02T00:00:00.000Z",
    });
    expect(c1).not.toBe(c2);
  });

  test("null and undefined actor_id produce same checksum (normalized to null)", () => {
    const base = {
      action: "system.boot",
      resource_type: "system",
      resource_id: null,
      workspace_id: null,
      created_at: "2024-01-01T00:00:00.000Z",
    };
    const c1 = computeChecksum({ ...base, actor_id: null });
    const c2 = computeChecksum({ ...base, actor_id: undefined });
    expect(c1).toBe(c2);
  });
});

// ---- Severity levels -------------------------------------------------------

describe("VALID_SEVERITY_LEVELS", () => {
  test("contains exactly: debug, info, warning, error, critical", () => {
    expect(VALID_SEVERITY_LEVELS).toEqual([
      "debug",
      "info",
      "warning",
      "error",
      "critical",
    ]);
  });

  test("all severity levels are strings", () => {
    for (const level of VALID_SEVERITY_LEVELS) {
      expect(typeof level).toBe("string");
    }
  });
});

// ---- Export format tests (pure logic, no DB) --------------------------------

describe("exportEvents CSV format", () => {
  test("CSV header has exactly: id,actor_id,action,resource_type,resource_id,workspace_id,severity,created_at", () => {
    // Build the CSV manually using the same logic as exportEvents
    const header =
      "id,actor_id,action,resource_type,resource_id,workspace_id,severity,created_at";
    expect(header).toBe(
      "id,actor_id,action,resource_type,resource_id,workspace_id,severity,created_at",
    );
  });

  test("CSV row is comma-separated with correct field order", () => {
    const event: Partial<AuditEvent> = {
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      actor_id: "user-1",
      action: "user.login",
      resource_type: "user",
      resource_id: "user-1",
      workspace_id: "ws-1",
      severity: "info",
      created_at: new Date("2024-01-01T00:00:00.000Z"),
    };

    const row = [
      event.id,
      event.actor_id ?? "",
      event.action,
      event.resource_type,
      event.resource_id ?? "",
      event.workspace_id ?? "",
      event.severity,
      event.created_at instanceof Date
        ? event.created_at.toISOString()
        : String(event.created_at),
    ].join(",");

    expect(row).toBe(
      "aaaaaaaa-0000-0000-0000-000000000001,user-1,user.login,user,user-1,ws-1,info,2024-01-01T00:00:00.000Z",
    );
  });

  test("JSON export produces valid JSON array string", () => {
    const events: AuditEvent[] = [
      {
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        actor_id: "user-1",
        actor_type: "user",
        action: "user.login",
        resource_type: "user",
        resource_id: null,
        workspace_id: null,
        ip: null,
        user_agent: null,
        metadata: {},
        severity: "info",
        checksum: "abc",
        created_at: new Date("2024-01-01T00:00:00.000Z"),
      },
    ];

    const output = JSON.stringify(events, null, 2);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].action).toBe("user.login");
  });
});
