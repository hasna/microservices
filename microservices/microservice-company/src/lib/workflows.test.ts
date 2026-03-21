import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Setup in-memory DB with workflow tables ────────────────────────────

const tempDir = mkdtempSync(join(tmpdir(), "workflow-test-"));
let testDb: Database;

beforeAll(() => {
  testDb = new Database(":memory:");
  testDb.exec("PRAGMA journal_mode = WAL");
  testDb.exec("PRAGMA foreign_keys = ON");

  // Apply workflow migration
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      name TEXT NOT NULL,
      trigger_event TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      trigger_data TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      steps_completed INTEGER NOT NULL DEFAULT 0,
      steps_total INTEGER,
      results TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_workflows_trigger ON workflows(trigger_event);
    CREATE INDEX IF NOT EXISTS idx_workflows_org ON workflows(org_id);
    CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
  `);
});

// Import after DB setup — inject test DB
import {
  setDatabase,
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  deleteWorkflow,
  enableWorkflow,
  disableWorkflow,
  resolveTemplate,
  runWorkflow,
  getWorkflowRun,
  getWorkflowRuns,
  getPresetWorkflows,
} from "./workflows";

beforeAll(() => {
  setDatabase(() => testDb);
});

afterAll(() => {
  testDb.close();
  rmSync(tempDir, { recursive: true, force: true });
});

// ── CRUD tests ─────────────────────────────────────────────────────────

describe("Workflow CRUD", () => {
  test("createWorkflow returns a workflow with an id", () => {
    const wf = createWorkflow({
      name: "Test Workflow",
      trigger_event: "deal.won",
      steps: [{ service: "invoices", action: "create" }],
    });

    expect(wf.id).toBeTruthy();
    expect(wf.name).toBe("Test Workflow");
    expect(wf.trigger_event).toBe("deal.won");
    expect(wf.steps).toEqual([{ service: "invoices", action: "create" }]);
    expect(wf.enabled).toBe(true);
    expect(wf.run_count).toBe(0);
    expect(wf.created_at).toBeTruthy();
  });

  test("createWorkflow with org_id and metadata", () => {
    const wf = createWorkflow({
      name: "Org Workflow",
      trigger_event: "new.hire",
      steps: [],
      org_id: "org-123",
      metadata: { priority: "high" },
    });

    expect(wf.org_id).toBe("org-123");
    expect(wf.metadata).toEqual({ priority: "high" });
  });

  test("getWorkflow returns the correct workflow", () => {
    const wf = createWorkflow({
      name: "Get Test",
      trigger_event: "test.event",
      steps: [{ service: "notes", action: "create", args: { title: "hello" } }],
    });

    const fetched = getWorkflow(wf.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(wf.id);
    expect(fetched!.name).toBe("Get Test");
    expect(fetched!.steps[0].args).toEqual({ title: "hello" });
  });

  test("getWorkflow returns null for nonexistent id", () => {
    expect(getWorkflow("nonexistent-id")).toBeNull();
  });

  test("listWorkflows returns all workflows", () => {
    const all = listWorkflows();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("listWorkflows filters by trigger_event", () => {
    const results = listWorkflows({ trigger_event: "deal.won" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((w) => w.trigger_event === "deal.won")).toBe(true);
  });

  test("listWorkflows filters by org_id", () => {
    const results = listWorkflows({ org_id: "org-123" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((w) => w.org_id === "org-123")).toBe(true);
  });

  test("listWorkflows filters by enabled", () => {
    const results = listWorkflows({ enabled: true });
    expect(results.every((w) => w.enabled === true)).toBe(true);
  });

  test("listWorkflows supports limit and offset", () => {
    const limited = listWorkflows({ limit: 1 });
    expect(limited.length).toBe(1);

    const offset = listWorkflows({ limit: 1, offset: 1 });
    expect(offset.length).toBe(1);
    expect(offset[0].id).not.toBe(limited[0].id);
  });

  test("updateWorkflow updates name", () => {
    const wf = createWorkflow({
      name: "Before Update",
      trigger_event: "test.update",
      steps: [],
    });

    const updated = updateWorkflow(wf.id, { name: "After Update" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("After Update");
  });

  test("updateWorkflow updates steps and metadata", () => {
    const wf = createWorkflow({
      name: "Update Steps",
      trigger_event: "test.steps",
      steps: [{ service: "a", action: "b" }],
    });

    const updated = updateWorkflow(wf.id, {
      steps: [{ service: "x", action: "y" }],
      metadata: { version: 2 },
    });

    expect(updated!.steps).toEqual([{ service: "x", action: "y" }]);
    expect(updated!.metadata).toEqual({ version: 2 });
  });

  test("updateWorkflow returns null for nonexistent id", () => {
    expect(updateWorkflow("nonexistent", { name: "nope" })).toBeNull();
  });

  test("updateWorkflow with no changes returns existing", () => {
    const wf = createWorkflow({
      name: "No Change",
      trigger_event: "test.nochange",
      steps: [],
    });
    const result = updateWorkflow(wf.id, {});
    expect(result!.name).toBe("No Change");
  });

  test("deleteWorkflow removes the workflow", () => {
    const wf = createWorkflow({
      name: "Delete Me",
      trigger_event: "test.delete",
      steps: [],
    });

    expect(deleteWorkflow(wf.id)).toBe(true);
    expect(getWorkflow(wf.id)).toBeNull();
  });

  test("deleteWorkflow returns false for nonexistent id", () => {
    expect(deleteWorkflow("nonexistent")).toBe(false);
  });

  test("enableWorkflow sets enabled to true", () => {
    const wf = createWorkflow({
      name: "Enable Test",
      trigger_event: "test.enable",
      steps: [],
    });

    disableWorkflow(wf.id);
    const enabled = enableWorkflow(wf.id);
    expect(enabled!.enabled).toBe(true);
  });

  test("disableWorkflow sets enabled to false", () => {
    const wf = createWorkflow({
      name: "Disable Test",
      trigger_event: "test.disable",
      steps: [],
    });

    const disabled = disableWorkflow(wf.id);
    expect(disabled!.enabled).toBe(false);
  });

  test("enableWorkflow returns null for nonexistent id", () => {
    expect(enableWorkflow("nonexistent")).toBeNull();
  });

  test("disableWorkflow returns null for nonexistent id", () => {
    expect(disableWorkflow("nonexistent")).toBeNull();
  });
});

// ── Template resolution tests ──────────────────────────────────────────

describe("Template Resolution", () => {
  test("resolves {{data.X}} from trigger data", () => {
    const result = resolveTemplate("Hello {{data.name}}", {
      data: { name: "Alice" },
    });
    expect(result).toBe("Hello Alice");
  });

  test("resolves nested {{data.customer.name}}", () => {
    const result = resolveTemplate("Customer: {{data.customer.name}}", {
      data: { customer: { name: "Acme Corp" } },
    });
    expect(result).toBe("Customer: Acme Corp");
  });

  test("resolves deeply nested paths", () => {
    const result = resolveTemplate("{{data.a.b.c}}", {
      data: { a: { b: { c: "deep" } } },
    });
    expect(result).toBe("deep");
  });

  test("resolves {{steps[0].output}}", () => {
    const result = resolveTemplate("Previous: {{steps[0].output}}", {
      steps: [
        {
          step_index: 0,
          service: "invoices",
          action: "create",
          status: "success",
          output: "INV-001",
          duration_ms: 100,
        },
      ],
    });
    expect(result).toBe("Previous: INV-001");
  });

  test("resolves multiple step references", () => {
    const steps = [
      { step_index: 0, service: "a", action: "b", status: "success" as const, output: "first", duration_ms: 10 },
      { step_index: 1, service: "c", action: "d", status: "success" as const, output: "second", duration_ms: 20 },
    ];
    const result = resolveTemplate("{{steps[0].output}} and {{steps[1].output}}", { steps });
    expect(result).toBe("first and second");
  });

  test("returns empty string for missing data path", () => {
    const result = resolveTemplate("{{data.missing}}", { data: {} });
    expect(result).toBe("");
  });

  test("returns empty string for missing step index", () => {
    const result = resolveTemplate("{{steps[5].output}}", { steps: [] });
    expect(result).toBe("");
  });

  test("handles null in nested path gracefully", () => {
    const result = resolveTemplate("{{data.a.b}}", {
      data: { a: null },
    });
    expect(result).toBe("");
  });

  test("resolves multiple data variables in one string", () => {
    const result = resolveTemplate("{{data.first}} {{data.last}}", {
      data: { first: "John", last: "Doe" },
    });
    expect(result).toBe("John Doe");
  });

  test("resolves numeric values as strings", () => {
    const result = resolveTemplate("Amount: {{data.amount}}", {
      data: { amount: 1500 },
    });
    expect(result).toBe("Amount: 1500");
  });

  test("handles template with no variables", () => {
    const result = resolveTemplate("no variables here", { data: {} });
    expect(result).toBe("no variables here");
  });
});

// ── Workflow run tracking ──────────────────────────────────────────────

describe("Workflow Run Tracking", () => {
  test("runWorkflow throws for nonexistent workflow", async () => {
    expect(runWorkflow("nonexistent-wf")).rejects.toThrow("not found");
  });

  test("runWorkflow throws for disabled workflow", async () => {
    const wf = createWorkflow({
      name: "Disabled Runner",
      trigger_event: "test.disabled",
      steps: [{ service: "notes", action: "create" }],
    });
    disableWorkflow(wf.id);

    expect(runWorkflow(wf.id)).rejects.toThrow("disabled");
  });

  test("runWorkflow creates a run record with steps", async () => {
    // Create a workflow with a step that will fail (service not installed)
    const wf = createWorkflow({
      name: "Run Tracker",
      trigger_event: "test.run",
      steps: [
        { service: "fake-service", action: "do-thing", on_failure: "continue" as const },
      ],
    });

    const run = await runWorkflow(wf.id, { key: "value" });

    expect(run.id).toBeTruthy();
    expect(run.workflow_id).toBe(wf.id);
    expect(run.trigger_data).toEqual({ key: "value" });
    expect(run.steps_total).toBe(1);
    expect(run.steps_completed).toBe(1);
    expect(run.results.length).toBe(1);
    expect(run.results[0].service).toBe("fake-service");
    expect(run.results[0].action).toBe("do-thing");
    expect(run.completed_at).toBeTruthy();
  });

  test("runWorkflow with on_failure=stop marks remaining as skipped", async () => {
    const wf = createWorkflow({
      name: "Stop On Fail",
      trigger_event: "test.stop",
      steps: [
        { service: "missing-svc", action: "step1", on_failure: "stop" as const },
        { service: "missing-svc", action: "step2" },
        { service: "missing-svc", action: "step3" },
      ],
    });

    const run = await runWorkflow(wf.id, {});

    expect(run.status).toBe("failed");
    expect(run.error).toBeTruthy();
    expect(run.results.length).toBe(3);
    expect(run.results[0].status).toBe("failed");
    expect(run.results[1].status).toBe("skipped");
    expect(run.results[2].status).toBe("skipped");
  });

  test("runWorkflow with on_failure=continue returns partial", async () => {
    const wf = createWorkflow({
      name: "Continue On Fail",
      trigger_event: "test.continue",
      steps: [
        { service: "missing-svc", action: "step1", on_failure: "continue" as const },
        { service: "missing-svc", action: "step2", on_failure: "continue" as const },
      ],
    });

    const run = await runWorkflow(wf.id, {});

    expect(run.status).toBe("partial");
    expect(run.results.length).toBe(2);
    expect(run.results[0].status).toBe("failed");
    expect(run.results[1].status).toBe("failed");
  });

  test("runWorkflow increments workflow run_count", async () => {
    const wf = createWorkflow({
      name: "Count Test",
      trigger_event: "test.count",
      steps: [{ service: "missing", action: "x", on_failure: "continue" as const }],
    });

    await runWorkflow(wf.id, {});
    await runWorkflow(wf.id, {});

    const updated = getWorkflow(wf.id);
    expect(updated!.run_count).toBe(2);
    expect(updated!.last_run_at).toBeTruthy();
  });

  test("getWorkflowRun returns the correct run", async () => {
    const wf = createWorkflow({
      name: "Get Run Test",
      trigger_event: "test.getrun",
      steps: [{ service: "x", action: "y", on_failure: "continue" as const }],
    });

    const run = await runWorkflow(wf.id, { hello: "world" });
    const fetched = getWorkflowRun(run.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(run.id);
    expect(fetched!.trigger_data).toEqual({ hello: "world" });
  });

  test("getWorkflowRun returns null for nonexistent id", () => {
    expect(getWorkflowRun("nonexistent-run")).toBeNull();
  });

  test("getWorkflowRuns returns runs for a workflow", async () => {
    const wf = createWorkflow({
      name: "List Runs",
      trigger_event: "test.listruns",
      steps: [{ service: "x", action: "y", on_failure: "continue" as const }],
    });

    await runWorkflow(wf.id, { run: 1 });
    await runWorkflow(wf.id, { run: 2 });

    const runs = getWorkflowRuns(wf.id);
    expect(runs.length).toBe(2);
  });

  test("getWorkflowRuns respects limit", async () => {
    const wf = createWorkflow({
      name: "Limit Runs",
      trigger_event: "test.limitruns",
      steps: [{ service: "x", action: "y", on_failure: "continue" as const }],
    });

    await runWorkflow(wf.id, {});
    await runWorkflow(wf.id, {});
    await runWorkflow(wf.id, {});

    const runs = getWorkflowRuns(wf.id, 2);
    expect(runs.length).toBe(2);
  });

  test("step results include duration_ms", async () => {
    const wf = createWorkflow({
      name: "Duration Test",
      trigger_event: "test.duration",
      steps: [{ service: "missing", action: "x", on_failure: "continue" as const }],
    });

    const run = await runWorkflow(wf.id, {});
    expect(run.results[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("runWorkflow with real CLI script executes successfully", async () => {
    // Create a fake microservice CLI in the temp dir
    const svcDir = join(tempDir, "microservice-fake-echo", "src", "cli");
    mkdirSync(svcDir, { recursive: true });
    writeFileSync(
      join(svcDir, "index.ts"),
      `
const args = process.argv.slice(2);
if (args[0] === "echo") {
  const msgIdx = args.indexOf("--message");
  console.log(msgIdx >= 0 ? args[msgIdx + 1] : "no-message");
}
`
    );

    // Point MICROSERVICES_DIR to temp dir so the CLI is found
    const origDir = process.env["MICROSERVICES_DIR"];
    process.env["MICROSERVICES_DIR"] = tempDir;

    try {
      const wf = createWorkflow({
        name: "Real CLI Test",
        trigger_event: "test.real",
        steps: [
          {
            service: "fake-echo",
            action: "echo",
            args: { message: "{{data.greeting}}" },
          },
        ],
      });

      const run = await runWorkflow(wf.id, { greeting: "hello-world" });

      expect(run.status).toBe("completed");
      expect(run.results[0].status).toBe("success");
      expect(run.results[0].output).toBe("hello-world");
    } finally {
      if (origDir) {
        process.env["MICROSERVICES_DIR"] = origDir;
      } else {
        delete process.env["MICROSERVICES_DIR"];
      }
    }
  });
});

// ── Preset workflows ───────────────────────────────────────────────────

describe("Preset Workflows", () => {
  test("getPresetWorkflows returns 5 presets", () => {
    const presets = getPresetWorkflows();
    expect(presets.length).toBe(5);
  });

  test("all presets have name, trigger_event, and steps", () => {
    const presets = getPresetWorkflows();
    for (const p of presets) {
      expect(p.name).toBeTruthy();
      expect(p.trigger_event).toBeTruthy();
      expect(Array.isArray(p.steps)).toBe(true);
      expect(p.steps.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("preset trigger events match expected names", () => {
    const presets = getPresetWorkflows();
    const events = presets.map((p) => p.trigger_event);
    expect(events).toContain("deal.won");
    expect(events).toContain("invoice.overdue");
    expect(events).toContain("payroll.close");
    expect(events).toContain("new.hire");
    expect(events).toContain("contract.expiring");
  });

  test("deal.won preset has invoice, contract, and notification steps", () => {
    const presets = getPresetWorkflows();
    const dealWon = presets.find((p) => p.trigger_event === "deal.won")!;
    expect(dealWon.steps.length).toBe(3);
    expect(dealWon.steps[0].service).toBe("invoices");
    expect(dealWon.steps[1].service).toBe("contracts");
  });

  test("preset steps contain template variables", () => {
    const presets = getPresetWorkflows();
    for (const p of presets) {
      const hasTemplates = p.steps.some(
        (s) => s.args && Object.values(s.args).some((v) => v.includes("{{"))
      );
      expect(hasTemplates).toBe(true);
    }
  });
});
