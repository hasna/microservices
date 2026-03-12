/**
 * CRM CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Types ---

export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Deal {
  id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value: number;
  currency: string;
  contact_name: string | null;
  contact_email: string | null;
  probability: number;
  expected_close_date: string | null;
  status: "open" | "won" | "lost";
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface DealActivity {
  id: string;
  deal_id: string;
  type: "note" | "call" | "email" | "meeting";
  description: string;
  created_at: string;
}

interface DealRow extends Omit<Deal, "metadata"> {
  metadata: string;
}

function rowToDeal(row: DealRow): Deal {
  return { ...row, metadata: JSON.parse(row.metadata || "{}") } as Deal;
}

// --- Pipelines ---

export interface CreatePipelineInput {
  name: string;
  description?: string;
}

export function createPipeline(input: CreatePipelineInput): Pipeline {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO pipelines (id, name, description) VALUES (?, ?, ?)`
  ).run(id, input.name, input.description || null);

  return db.prepare("SELECT * FROM pipelines WHERE id = ?").get(id) as Pipeline;
}

export function listPipelines(): Pipeline[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM pipelines ORDER BY name").all() as Pipeline[];
}

// --- Stages ---

export interface CreateStageInput {
  pipeline_id: string;
  name: string;
  sort_order?: number;
}

export function createStage(input: CreateStageInput): Stage {
  const db = getDatabase();
  const id = crypto.randomUUID();

  let sortOrder = input.sort_order;
  if (sortOrder === undefined) {
    const max = db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) as max_order FROM stages WHERE pipeline_id = ?")
      .get(input.pipeline_id) as { max_order: number };
    sortOrder = max.max_order + 1;
  }

  db.prepare(
    `INSERT INTO stages (id, pipeline_id, name, sort_order) VALUES (?, ?, ?, ?)`
  ).run(id, input.pipeline_id, input.name, sortOrder);

  return db.prepare("SELECT * FROM stages WHERE id = ?").get(id) as Stage;
}

export function listStages(pipeline_id: string): Stage[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM stages WHERE pipeline_id = ? ORDER BY sort_order")
    .all(pipeline_id) as Stage[];
}

// --- Deals ---

export interface CreateDealInput {
  pipeline_id: string;
  stage_id: string;
  title: string;
  value?: number;
  currency?: string;
  contact_name?: string;
  contact_email?: string;
  probability?: number;
  expected_close_date?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function createDeal(input: CreateDealInput): Deal {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO deals (id, pipeline_id, stage_id, title, value, currency, contact_name, contact_email, probability, expected_close_date, notes, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.pipeline_id,
    input.stage_id,
    input.title,
    input.value || 0,
    input.currency || "USD",
    input.contact_name || null,
    input.contact_email || null,
    input.probability || 0,
    input.expected_close_date || null,
    input.notes || null,
    metadata
  );

  return getDeal(id)!;
}

export function getDeal(id: string): Deal | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM deals WHERE id = ?").get(id) as DealRow | null;
  return row ? rowToDeal(row) : null;
}

export interface ListDealsOptions {
  pipeline_id?: string;
  stage_id?: string;
  status?: string;
  limit?: number;
}

export function listDeals(options: ListDealsOptions = {}): Deal[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.pipeline_id) {
    conditions.push("pipeline_id = ?");
    params.push(options.pipeline_id);
  }
  if (options.stage_id) {
    conditions.push("stage_id = ?");
    params.push(options.stage_id);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM deals";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params) as DealRow[];
  return rows.map(rowToDeal);
}

export interface UpdateDealInput {
  title?: string;
  value?: number;
  currency?: string;
  contact_name?: string;
  contact_email?: string;
  probability?: number;
  expected_close_date?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function updateDeal(id: string, input: UpdateDealInput): Deal | null {
  const db = getDatabase();
  const existing = getDeal(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.value !== undefined) {
    sets.push("value = ?");
    params.push(input.value);
  }
  if (input.currency !== undefined) {
    sets.push("currency = ?");
    params.push(input.currency);
  }
  if (input.contact_name !== undefined) {
    sets.push("contact_name = ?");
    params.push(input.contact_name);
  }
  if (input.contact_email !== undefined) {
    sets.push("contact_email = ?");
    params.push(input.contact_email);
  }
  if (input.probability !== undefined) {
    sets.push("probability = ?");
    params.push(input.probability);
  }
  if (input.expected_close_date !== undefined) {
    sets.push("expected_close_date = ?");
    params.push(input.expected_close_date);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(input.notes);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE deals SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getDeal(id);
}

export function moveDeal(id: string, stage_id: string): Deal | null {
  const db = getDatabase();
  const existing = getDeal(id);
  if (!existing) return null;

  db.prepare(
    "UPDATE deals SET stage_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(stage_id, id);

  return getDeal(id);
}

export function closeDeal(id: string, outcome: "won" | "lost"): Deal | null {
  const db = getDatabase();
  const existing = getDeal(id);
  if (!existing) return null;

  db.prepare(
    "UPDATE deals SET status = ?, closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(outcome, id);

  return getDeal(id);
}

export function deleteDeal(id: string): boolean {
  const db = getDatabase();
  return db.prepare("DELETE FROM deals WHERE id = ?").run(id).changes > 0;
}

// --- Activities ---

export interface AddActivityInput {
  deal_id: string;
  type?: "note" | "call" | "email" | "meeting";
  description: string;
}

export function addActivity(input: AddActivityInput): DealActivity {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO deal_activities (id, deal_id, type, description) VALUES (?, ?, ?, ?)`
  ).run(id, input.deal_id, input.type || "note", input.description);

  return db.prepare("SELECT * FROM deal_activities WHERE id = ?").get(id) as DealActivity;
}

export function listActivities(deal_id: string): DealActivity[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM deal_activities WHERE deal_id = ? ORDER BY created_at DESC")
    .all(deal_id) as DealActivity[];
}

// --- Summary ---

export interface StageSummary {
  stage_id: string;
  stage_name: string;
  deal_count: number;
  total_value: number;
}

export interface PipelineSummary {
  pipeline_id: string;
  pipeline_name: string;
  total_deals: number;
  open_deals: number;
  won_deals: number;
  lost_deals: number;
  total_value: number;
  weighted_value: number;
  stages: StageSummary[];
}

export function getPipelineSummary(pipeline_id: string): PipelineSummary | null {
  const db = getDatabase();

  const pipeline = db
    .prepare("SELECT * FROM pipelines WHERE id = ?")
    .get(pipeline_id) as Pipeline | null;
  if (!pipeline) return null;

  const counts = db
    .prepare(
      `SELECT
        COUNT(*) as total_deals,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_deals,
        SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_deals,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_deals,
        COALESCE(SUM(value), 0) as total_value,
        COALESCE(SUM(value * probability / 100.0), 0) as weighted_value
      FROM deals WHERE pipeline_id = ?`
    )
    .get(pipeline_id) as {
    total_deals: number;
    open_deals: number;
    won_deals: number;
    lost_deals: number;
    total_value: number;
    weighted_value: number;
  };

  const stages = db
    .prepare(
      `SELECT
        s.id as stage_id,
        s.name as stage_name,
        COUNT(d.id) as deal_count,
        COALESCE(SUM(d.value), 0) as total_value
      FROM stages s
      LEFT JOIN deals d ON d.stage_id = s.id AND d.status = 'open'
      WHERE s.pipeline_id = ?
      GROUP BY s.id, s.name
      ORDER BY s.sort_order`
    )
    .all(pipeline_id) as StageSummary[];

  return {
    pipeline_id: pipeline.id,
    pipeline_name: pipeline.name,
    ...counts,
    stages,
  };
}
