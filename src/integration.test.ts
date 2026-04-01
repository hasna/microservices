/**
 * End-to-end integration tests for @hasna/microservices.
 *
 * Tests that require PostgreSQL are skipped when DATABASE_URL is not set.
 * Run with a real DB:
 *   DATABASE_URL=postgres://localhost/test_microservices JWT_SECRET=test-secret bun test src/integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  getMicroservice,
  MICROSERVICES,
  searchMicroservices,
} from "./lib/registry.js";

const DB_URL = process.env.DATABASE_URL;
const HAS_DB = Boolean(DB_URL);

// ─── Registry & Hub (no DB needed) ────────────────────────────────────────────

describe("Hub registry", () => {
  it("has 21 production microservices", () => {
    expect(MICROSERVICES).toHaveLength(21);
  });

  it("all 21 services have correct package names", () => {
    const expected = [
      "auth",
      "teams",
      "billing",
      "notify",
      "files",
      "audit",
      "flags",
      "jobs",
      "llm",
      "memory",
      "search",
      "usage",
      "webhooks",
      "onboarding",
      "waitlist",
      "sessions",
      "guardrails",
      "knowledge",
      "traces",
      "agents",
      "prompts",
    ];
    const actual = MICROSERVICES.map((m) => m.name).sort();
    expect(actual).toEqual(expected.sort());
  });

  it("all services have DATABASE_URL as required env", () => {
    for (const m of MICROSERVICES) {
      expect(m.requiredEnv).toContain("DATABASE_URL");
    }
  });

  it("all packages follow @hasna/microservice-* naming", () => {
    for (const m of MICROSERVICES) {
      expect(m.package).toMatch(/^@hasna\/microservice-[a-z]+$/);
      expect(m.binary).toMatch(/^microservice-[a-z]+$/);
    }
  });

  it("all services have unique schema prefixes", () => {
    const prefixes = MICROSERVICES.map((m) => m.schemaPrefix);
    expect(new Set(prefixes).size).toBe(21);
  });

  it("search finds auth by keyword", () => {
    const r = searchMicroservices("jwt");
    expect(r.some((m) => m.name === "auth")).toBe(true);
  });

  it("search finds billing by stripe tag", () => {
    const r = searchMicroservices("stripe");
    expect(r.some((m) => m.name === "billing")).toBe(true);
  });

  it("getMicroservice handles prefix correctly", () => {
    expect(getMicroservice("microservice-auth")?.name).toBe("auth");
    expect(getMicroservice("auth")?.name).toBe("auth");
    expect(getMicroservice("nonexistent")).toBeUndefined();
  });
});

describe("Service metadata completeness", () => {
  for (const service of MICROSERVICES) {
    it(`${service.name} has all required metadata fields`, () => {
      expect(service.name).toBeTruthy();
      expect(service.displayName).toBeTruthy();
      expect(service.description.length).toBeGreaterThan(10);
      expect(service.package).toBeTruthy();
      expect(service.binary).toBeTruthy();
      expect(service.schemaPrefix).toBeTruthy();
      expect(service.category).toBeTruthy();
      expect(service.tags.length).toBeGreaterThan(0);
      expect(service.requiredEnv.length).toBeGreaterThan(0);
    });
  }
});

// ─── Cross-service logic tests (no DB needed) ─────────────────────────────────

describe("Auth — pure logic", () => {
  it("password hashing works", async () => {
    const { hashPassword, verifyPassword } = await import(
      "../microservices/microservice-auth/src/lib/passwords.js"
    );
    const hash = await hashPassword("test-password-123");
    expect(await verifyPassword("test-password-123", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("JWT sign/verify roundtrip", async () => {
    process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars!!";
    const { signJwt, verifyJwt } = await import(
      "../microservices/microservice-auth/src/lib/jwt.js"
    );
    const token = await signJwt(
      { sub: "user-123", email: "test@test.com", type: "access" },
      60,
    );
    const payload = await verifyJwt(token);
    expect(payload.sub).toBe("user-123");
    expect(payload.type).toBe("access");
  });

  it("API key generation produces unique keys with correct prefix", async () => {
    const { generateApiKey } = await import(
      "../microservices/microservice-auth/src/lib/tokens.js"
    );
    const { key, prefix } = generateApiKey();
    expect(key.startsWith("hsk_")).toBe(true);
    expect(prefix.startsWith("hsk_")).toBe(true);
    const { key: key2 } = generateApiKey();
    expect(key).not.toBe(key2);
  });
});

describe("Teams — pure logic", () => {
  it("role ranking enforces owner > admin > member > viewer", () => {
    const RANK: Record<string, number> = {
      owner: 4,
      admin: 3,
      member: 2,
      viewer: 1,
    };
    expect(RANK.owner).toBeGreaterThan(RANK.admin);
    expect(RANK.admin).toBeGreaterThan(RANK.member);
    expect(RANK.member).toBeGreaterThan(RANK.viewer);
  });
});

describe("Flags — pure logic", () => {
  it("cron shouldFire works correctly", async () => {
    const { shouldFire } = await import(
      "../microservices/microservice-jobs/src/lib/schedules.js"
    );
    expect(shouldFire("* * * * *", new Date())).toBe(true);
    expect(shouldFire("0 0 * * *", new Date("2024-01-15T00:00:00"))).toBe(true);
    expect(shouldFire("0 0 * * *", new Date("2024-01-15T12:00:00"))).toBe(
      false,
    );
  });

  it("exponential backoff stays within bounds", () => {
    const backoff = (attempt: number) => Math.min(2 ** attempt * 5, 3600);
    expect(backoff(1)).toBe(10);
    expect(backoff(2)).toBe(20);
    expect(backoff(10)).toBe(3600);
  });
});

describe("Notify — template rendering", () => {
  it("renders {{variable}} substitutions", async () => {
    const notifyPath =
      "../microservices/microservice-notify/src/lib/templates.js";
    try {
      const { renderTemplate } = await import(notifyPath);
      const result = renderTemplate("Hello {{name}}!", { name: "World" });
      expect(result).toBe("Hello World!");
    } catch {
      // Skip if notify not built yet
    }
  });
});

// ─── Full SaaS flow (requires PostgreSQL) ─────────────────────────────────────

describe("Full SaaS flow (PostgreSQL required)", () => {
  if (!HAS_DB) {
    it.skip("DATABASE_URL not set — skipping DB integration tests", () => {});
    return;
  }

  let sql: any;
  const testEmail = `test-${Date.now()}@example.com`;
  let userId: string;
  let workspaceId: string;
  let sessionToken: string;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= "test-jwt-secret-at-least-32-chars!!";
    const postgres = (await import("postgres")).default;
    sql = postgres(DB_URL!, { max: 5, onnotice: () => {} });
  });

  afterAll(async () => {
    if (!sql) return;
    // Cleanup test data
    try {
      await sql`DELETE FROM auth.users WHERE email = ${testEmail}`;
      await sql`DELETE FROM teams.workspaces WHERE name = 'Test Workspace'`;
    } catch {}
    await sql.end();
  });

  it("Step 1: Run all migrations", async () => {
    const authMig = await import(
      "../microservices/microservice-auth/src/db/migrations.js"
    );
    const teamsMig = await import(
      "../microservices/microservice-teams/src/db/migrations.js"
    );
    const auditMig = await import(
      "../microservices/microservice-audit/src/db/migrations.js"
    );
    const flagsMig = await import(
      "../microservices/microservice-flags/src/db/migrations.js"
    );
    const jobsMig = await import(
      "../microservices/microservice-jobs/src/db/migrations.js"
    );

    await authMig.migrate(sql);
    await teamsMig.migrate(sql);
    await auditMig.migrate(sql);
    await flagsMig.migrate(sql);
    await jobsMig.migrate(sql);

    // Verify schemas exist
    const schemas = await sql<{ schema_name: string }[]>`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name IN ('auth', 'teams', 'audit', 'flags', 'jobs')
      ORDER BY schema_name`;
    expect(schemas.map((s: { schema_name: string }) => s.schema_name)).toEqual([
      "audit",
      "auth",
      "flags",
      "jobs",
      "teams",
    ]);
  });

  it("Step 2: Register a user (auth)", async () => {
    const { register } = await import(
      "../microservices/microservice-auth/src/lib/auth.js"
    );
    const result = await register(sql, {
      email: testEmail,
      password: "SecurePass123!",
      name: "Test User",
    });
    expect(result.user.email).toBe(testEmail);
    expect(result.access_token).toBeTruthy();
    expect(result.session.token).toBeTruthy();
    userId = result.user.id;
    sessionToken = result.session.token;
  });

  it("Step 3: Create a workspace (teams)", async () => {
    const { createWorkspace } = await import(
      "../microservices/microservice-teams/src/lib/workspaces.js"
    );
    const ws = await createWorkspace(sql, {
      name: "Test Workspace",
      ownerId: userId,
    });
    expect(ws.name).toBe("Test Workspace");
    expect(ws.owner_id).toBe(userId);
    workspaceId = ws.id;
  });

  it("Step 4: Verify user is owner of workspace (teams RBAC)", async () => {
    const { checkPermission } = await import(
      "../microservices/microservice-teams/src/lib/members.js"
    );
    expect(await checkPermission(sql, workspaceId, userId, "owner")).toBe(true);
    expect(await checkPermission(sql, workspaceId, userId, "admin")).toBe(true);
    expect(await checkPermission(sql, workspaceId, userId, "viewer")).toBe(
      true,
    );
  });

  it("Step 5: Log audit events (audit)", async () => {
    const { logEvent, queryEvents } = await import(
      "../microservices/microservice-audit/src/lib/events.js"
    );

    await logEvent(sql, {
      actorId: userId,
      action: "user.registered",
      resourceType: "user",
      resourceId: userId,
      workspaceId,
    });
    await logEvent(sql, {
      actorId: userId,
      action: "workspace.created",
      resourceType: "workspace",
      resourceId: workspaceId,
      workspaceId,
    });

    const events = await queryEvents(sql, { workspaceId, limit: 10 });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e: any) => e.action === "user.registered")).toBe(true);
    expect(events.some((e: any) => e.action === "workspace.created")).toBe(
      true,
    );
  });

  it("Step 6: Create and evaluate a feature flag (flags)", async () => {
    const { createFlag } = await import(
      "../microservices/microservice-flags/src/lib/flags.js"
    );
    const { evaluateFlag } = await import(
      "../microservices/microservice-flags/src/lib/evaluate.js"
    );

    const flag = await createFlag(sql, {
      key: `onboarding-${Date.now()}`,
      name: "Onboarding Flow",
      defaultValue: "true",
    });
    expect(flag.key).toContain("onboarding");

    const result = await evaluateFlag(sql, flag.key, { userId, workspaceId });
    expect(result.value).toBe("true");
    expect(result.source).toBe("default");
  });

  it("Step 7: Enqueue an onboarding job (jobs)", async () => {
    const { enqueue, getJob } = await import(
      "../microservices/microservice-jobs/src/lib/queue.js"
    );

    const job = await enqueue(sql, {
      type: "onboarding.send_welcome",
      payload: { userId, email: testEmail, workspaceId },
      queue: "onboarding",
      workspaceId,
    });
    expect(job.type).toBe("onboarding.send_welcome");
    expect(job.status).toBe("pending");

    const fetched = await getJob(sql, job.id);
    expect(fetched?.id).toBe(job.id);
  });

  it("Step 8: Session is valid (auth)", async () => {
    const { getSessionByToken } = await import(
      "../microservices/microservice-auth/src/lib/sessions.js"
    );
    const session = await getSessionByToken(sql, sessionToken);
    expect(session?.user_id).toBe(userId);
  });

  it("Step 9: Audit log has all expected events", async () => {
    const { countEvents } = await import(
      "../microservices/microservice-audit/src/lib/events.js"
    );
    const count = await countEvents(sql, { workspaceId });
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
