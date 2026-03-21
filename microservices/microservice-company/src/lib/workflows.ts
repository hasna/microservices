/**
 * Workflow engine — orchestrates multi-service automation for microservice-company
 */

import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execFile } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────────

export interface WorkflowStep {
  service: string;
  action: string;
  args?: Record<string, string>;
  on_failure?: "stop" | "continue" | `retry:${number}`;
}

export interface Workflow {
  id: string;
  org_id: string | null;
  name: string;
  trigger_event: string;
  steps: WorkflowStep[];
  enabled: boolean;
  last_run_at: string | null;
  run_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface WorkflowRow {
  id: string;
  org_id: string | null;
  name: string;
  trigger_event: string;
  steps: string;
  enabled: number;
  last_run_at: string | null;
  run_count: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface StepResult {
  step_index: number;
  service: string;
  action: string;
  status: "success" | "failed" | "skipped";
  output: string;
  duration_ms: number;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  trigger_data: Record<string, unknown> | null;
  status: "running" | "completed" | "failed" | "partial";
  steps_completed: number;
  steps_total: number;
  results: StepResult[];
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  trigger_data: string | null;
  status: string;
  steps_completed: number;
  steps_total: number;
  results: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

export interface CreateWorkflowInput {
  name: string;
  trigger_event: string;
  steps: WorkflowStep[];
  org_id?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkflowInput {
  name?: string;
  trigger_event?: string;
  steps?: WorkflowStep[];
  org_id?: string;
  metadata?: Record<string, unknown>;
}

export interface ListWorkflowsOptions {
  org_id?: string;
  trigger_event?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

// ── Database access ────────────────────────────────────────────────────

// The database getter is injected to avoid circular dependency with the
// other agent's database.ts. Tests provide their own DB via setDatabase().
type DatabaseGetter = () => import("bun:sqlite").Database;

let _getDb: DatabaseGetter | null = null;

export function setDatabase(getter: DatabaseGetter): void {
  _getDb = getter;
}

function db() {
  if (!_getDb) {
    // Lazy import — the other agent's database.ts will exist at runtime
    try {
      const mod = require("../db/database.js");
      _getDb = mod.getDatabase;
    } catch {
      throw new Error(
        "No database configured. Call setDatabase() or ensure ../db/database.ts exists."
      );
    }
  }
  return _getDb();
}

// ── Row converters ─────────────────────────────────────────────────────

function rowToWorkflow(row: WorkflowRow): Workflow {
  return {
    ...row,
    steps: JSON.parse(row.steps || "[]"),
    enabled: row.enabled === 1,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

function rowToWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  return {
    ...row,
    trigger_data: row.trigger_data ? JSON.parse(row.trigger_data) : null,
    status: row.status as WorkflowRun["status"],
    results: JSON.parse(row.results || "[]"),
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────

export function createWorkflow(input: CreateWorkflowInput): Workflow {
  const id = crypto.randomUUID();
  const steps = JSON.stringify(input.steps);
  const metadata = JSON.stringify(input.metadata || {});

  db()
    .prepare(
      `INSERT INTO workflows (id, org_id, name, trigger_event, steps, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.org_id || null, input.name, input.trigger_event, steps, metadata);

  return getWorkflow(id)!;
}

export function getWorkflow(id: string): Workflow | null {
  const row = db()
    .prepare("SELECT * FROM workflows WHERE id = ?")
    .get(id) as WorkflowRow | null;
  return row ? rowToWorkflow(row) : null;
}

export function listWorkflows(options: ListWorkflowsOptions = {}): Workflow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.org_id !== undefined) {
    conditions.push("org_id = ?");
    params.push(options.org_id);
  }
  if (options.trigger_event !== undefined) {
    conditions.push("trigger_event = ?");
    params.push(options.trigger_event);
  }
  if (options.enabled !== undefined) {
    conditions.push("enabled = ?");
    params.push(options.enabled ? 1 : 0);
  }

  let sql = "SELECT * FROM workflows";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db().prepare(sql).all(...params) as WorkflowRow[];
  return rows.map(rowToWorkflow);
}

export function updateWorkflow(id: string, input: UpdateWorkflowInput): Workflow | null {
  const existing = getWorkflow(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.trigger_event !== undefined) {
    sets.push("trigger_event = ?");
    params.push(input.trigger_event);
  }
  if (input.steps !== undefined) {
    sets.push("steps = ?");
    params.push(JSON.stringify(input.steps));
  }
  if (input.org_id !== undefined) {
    sets.push("org_id = ?");
    params.push(input.org_id);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db()
    .prepare(`UPDATE workflows SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);

  return getWorkflow(id);
}

export function deleteWorkflow(id: string): boolean {
  const result = db().prepare("DELETE FROM workflows WHERE id = ?").run(id);
  return result.changes > 0;
}

export function enableWorkflow(id: string): Workflow | null {
  const existing = getWorkflow(id);
  if (!existing) return null;
  db()
    .prepare("UPDATE workflows SET enabled = 1, updated_at = datetime('now') WHERE id = ?")
    .run(id);
  return getWorkflow(id);
}

export function disableWorkflow(id: string): Workflow | null {
  const existing = getWorkflow(id);
  if (!existing) return null;
  db()
    .prepare("UPDATE workflows SET enabled = 0, updated_at = datetime('now') WHERE id = ?")
    .run(id);
  return getWorkflow(id);
}

// ── Template resolution ────────────────────────────────────────────────

/**
 * Resolve template variables in a string.
 * Supports:
 *   {{data.field}}          — from trigger data
 *   {{data.nested.field}}   — dot-path into trigger data
 *   {{steps[0].output}}     — output from a previous step
 */
export function resolveTemplate(
  template: string,
  context: { data?: Record<string, unknown>; steps?: StepResult[] }
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();

    // {{steps[N].output}}
    const stepMatch = trimmed.match(/^steps\[(\d+)\]\.output$/);
    if (stepMatch) {
      const idx = parseInt(stepMatch[1], 10);
      if (context.steps && context.steps[idx]) {
        return context.steps[idx].output;
      }
      return "";
    }

    // {{data.X}} or {{data.X.Y}}
    if (trimmed.startsWith("data.")) {
      const path = trimmed.slice(5).split(".");
      let current: unknown = context.data || {};
      for (const key of path) {
        if (current === null || current === undefined || typeof current !== "object") {
          return "";
        }
        current = (current as Record<string, unknown>)[key];
      }
      return current !== null && current !== undefined ? String(current) : "";
    }

    return "";
  });
}

// ── Microservice CLI path resolution ───────────────────────────────────

function getMicroservicesDir(): string {
  if (process.env["MICROSERVICES_DIR"]) {
    return process.env["MICROSERVICES_DIR"];
  }

  let dir = resolve(process.cwd());
  while (true) {
    const candidate = join(dir, ".microservices");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  return join(home, ".microservices");
}

function getMicroserviceCliPath(name: string): string | null {
  const dir = getMicroservicesDir();
  const msName = name.startsWith("microservice-") ? name : `microservice-${name}`;

  const candidates = [
    join(dir, msName, "src", "cli", "index.ts"),
    join(dir, msName, "cli.ts"),
    join(dir, msName, "src", "index.ts"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

// ── Step execution ─────────────────────────────────────────────────────

async function executeStep(
  step: WorkflowStep,
  context: { data: Record<string, unknown>; steps: StepResult[] }
): Promise<StepResult> {
  const start = Date.now();

  // Build CLI args from the step definition
  const cliArgs: string[] = [step.action];
  if (step.args) {
    for (const [key, rawValue] of Object.entries(step.args)) {
      const value = resolveTemplate(rawValue, context);
      cliArgs.push(`--${key}`, value);
    }
  }

  const cliPath = getMicroserviceCliPath(step.service);
  if (!cliPath) {
    return {
      step_index: context.steps.length,
      service: step.service,
      action: step.action,
      status: "failed",
      output: `CLI not found for service '${step.service}'`,
      duration_ms: Date.now() - start,
    };
  }

  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        "bun",
        ["run", cliPath, ...cliArgs],
        {
          timeout: 30000,
          env: { ...process.env, MICROSERVICES_DIR: getMicroservicesDir() },
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || stdout || error.message));
            return;
          }
          resolve((stdout || "").trim());
        }
      );
    });

    return {
      step_index: context.steps.length,
      service: step.service,
      action: step.action,
      status: "success",
      output,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      step_index: context.steps.length,
      service: step.service,
      action: step.action,
      status: "failed",
      output: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - start,
    };
  }
}

// ── Workflow runner ────────────────────────────────────────────────────

export async function runWorkflow(
  id: string,
  triggerData: Record<string, unknown> = {}
): Promise<WorkflowRun> {
  const workflow = getWorkflow(id);
  if (!workflow) throw new Error(`Workflow '${id}' not found`);
  if (!workflow.enabled) throw new Error(`Workflow '${workflow.name}' is disabled`);

  // Create workflow_run record
  const runId = crypto.randomUUID();
  db()
    .prepare(
      `INSERT INTO workflow_runs (id, workflow_id, trigger_data, status, steps_total)
     VALUES (?, ?, ?, 'running', ?)`
    )
    .run(runId, id, JSON.stringify(triggerData), workflow.steps.length);

  const context: { data: Record<string, unknown>; steps: StepResult[] } = {
    data: triggerData,
    steps: [],
  };

  let finalStatus: WorkflowRun["status"] = "completed";
  let errorMsg: string | null = null;

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const onFailure = step.on_failure || "stop";

    let result: StepResult | null = null;

    if (onFailure.startsWith("retry:")) {
      const maxRetries = parseInt(onFailure.split(":")[1], 10) || 1;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        result = await executeStep(step, context);
        if (result.status === "success") break;
      }
    } else {
      result = await executeStep(step, context);
    }

    context.steps.push(result!);

    // Update progress in DB
    db()
      .prepare(
        `UPDATE workflow_runs SET steps_completed = ?, results = ? WHERE id = ?`
      )
      .run(i + 1, JSON.stringify(context.steps), runId);

    if (result!.status === "failed") {
      if (onFailure === "stop") {
        finalStatus = "failed";
        errorMsg = `Step ${i} (${step.service}.${step.action}) failed: ${result!.output}`;
        // Mark remaining steps as skipped
        for (let j = i + 1; j < workflow.steps.length; j++) {
          context.steps.push({
            step_index: j,
            service: workflow.steps[j].service,
            action: workflow.steps[j].action,
            status: "skipped",
            output: "",
            duration_ms: 0,
          });
        }
        break;
      } else if (onFailure === "continue") {
        finalStatus = "partial";
      }
    }
  }

  // Finalize the run
  db()
    .prepare(
      `UPDATE workflow_runs
     SET status = ?, results = ?, completed_at = datetime('now'), error = ?
     WHERE id = ?`
    )
    .run(finalStatus, JSON.stringify(context.steps), errorMsg, runId);

  // Update workflow stats
  db()
    .prepare(
      `UPDATE workflows
     SET last_run_at = datetime('now'), run_count = run_count + 1, updated_at = datetime('now')
     WHERE id = ?`
    )
    .run(id);

  return getWorkflowRun(runId)!;
}

// ── Run queries ────────────────────────────────────────────────────────

export function getWorkflowRun(runId: string): WorkflowRun | null {
  const row = db()
    .prepare("SELECT * FROM workflow_runs WHERE id = ?")
    .get(runId) as WorkflowRunRow | null;
  return row ? rowToWorkflowRun(row) : null;
}

export function getWorkflowRuns(workflowId: string, limit: number = 20): WorkflowRun[] {
  const rows = db()
    .prepare(
      "SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?"
    )
    .all(workflowId, limit) as WorkflowRunRow[];
  return rows.map(rowToWorkflowRun);
}

// ── Preset workflows ───────────────────────────────────────────────────

export interface PresetWorkflow {
  name: string;
  trigger_event: string;
  steps: WorkflowStep[];
}

export function getPresetWorkflows(): PresetWorkflow[] {
  return [
    {
      name: "Deal Won",
      trigger_event: "deal.won",
      steps: [
        {
          service: "invoices",
          action: "create",
          args: {
            client: "{{data.customer_name}}",
            amount: "{{data.deal_amount}}",
            description: "Invoice for deal {{data.deal_name}}",
          },
        },
        {
          service: "contracts",
          action: "create",
          args: {
            title: "Contract for {{data.customer_name}}",
            type: "service-agreement",
            value: "{{data.deal_amount}}",
          },
        },
        {
          service: "notes",
          action: "create",
          args: {
            title: "Deal won: {{data.deal_name}}",
            content: "Deal closed with {{data.customer_name}} for {{data.deal_amount}}",
          },
        },
      ],
    },
    {
      name: "Invoice Overdue",
      trigger_event: "invoice.overdue",
      steps: [
        {
          service: "notes",
          action: "create",
          args: {
            title: "Overdue reminder: {{data.invoice_id}}",
            content: "Invoice {{data.invoice_id}} for {{data.customer_name}} is overdue by {{data.days_overdue}} days",
          },
          on_failure: "continue",
        },
        {
          service: "calendar",
          action: "create",
          args: {
            title: "Follow up on overdue invoice {{data.invoice_id}}",
            description: "Contact {{data.customer_name}} about overdue payment",
          },
          on_failure: "continue",
        },
        {
          service: "notes",
          action: "create",
          args: {
            title: "Audit: overdue invoice {{data.invoice_id}}",
            content: "Logged overdue event for {{data.customer_name}}, amount: {{data.amount}}",
          },
        },
      ],
    },
    {
      name: "Payroll Close",
      trigger_event: "payroll.close",
      steps: [
        {
          service: "payroll",
          action: "process",
          args: {
            period: "{{data.period}}",
            org_id: "{{data.org_id}}",
          },
        },
        {
          service: "bookkeeping",
          action: "create",
          args: {
            type: "expense",
            category: "payroll",
            amount: "{{data.total_amount}}",
            description: "Payroll for period {{data.period}}",
          },
        },
        {
          service: "notes",
          action: "create",
          args: {
            title: "Payroll report: {{data.period}}",
            content: "Processed payroll for {{data.employee_count}} employees, total: {{data.total_amount}}",
          },
        },
      ],
    },
    {
      name: "New Hire",
      trigger_event: "new.hire",
      steps: [
        {
          service: "contracts",
          action: "create",
          args: {
            title: "Employment contract: {{data.employee_name}}",
            type: "employment",
            value: "{{data.salary}}",
          },
        },
        {
          service: "payroll",
          action: "add-employee",
          args: {
            name: "{{data.employee_name}}",
            salary: "{{data.salary}}",
            start_date: "{{data.start_date}}",
          },
        },
        {
          service: "calendar",
          action: "create",
          args: {
            title: "Onboarding: {{data.employee_name}}",
            description: "Complete onboarding tasks for {{data.employee_name}} starting {{data.start_date}}",
          },
        },
      ],
    },
    {
      name: "Contract Expiring",
      trigger_event: "contract.expiring",
      steps: [
        {
          service: "notes",
          action: "create",
          args: {
            title: "Contract expiring: {{data.contract_title}}",
            content: "Contract {{data.contract_id}} with {{data.party_name}} expires on {{data.expiry_date}}",
          },
        },
        {
          service: "calendar",
          action: "create",
          args: {
            title: "Renew contract: {{data.contract_title}}",
            description: "Review and renew contract with {{data.party_name}} before {{data.expiry_date}}",
          },
        },
      ],
    },
  ];
}
