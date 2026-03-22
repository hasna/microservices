/**
 * Project, Milestone, and Deliverable CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Types ---

export interface Project {
  id: string;
  name: string;
  description: string | null;
  client: string | null;
  status: string;
  budget: number | null;
  spent: number;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  owner: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  client: string | null;
  status: string;
  budget: number | null;
  spent: number;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  owner: string | null;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface Milestone {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  status: string;
  completed_at: string | null;
  created_at: string;
}

export interface Deliverable {
  id: string;
  milestone_id: string;
  name: string;
  description: string | null;
  status: string;
  assignee: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
}

// --- Project CRUD ---

export interface CreateProjectInput {
  name: string;
  description?: string;
  client?: string;
  status?: string;
  budget?: number;
  spent?: number;
  currency?: string;
  start_date?: string;
  end_date?: string;
  owner?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function createProject(input: CreateProjectInput): Project {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const tags = JSON.stringify(input.tags || []);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO projects (id, name, description, client, status, budget, spent, currency, start_date, end_date, owner, tags, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.description || null,
    input.client || null,
    input.status || "planning",
    input.budget ?? null,
    input.spent ?? 0,
    input.currency || "USD",
    input.start_date || null,
    input.end_date || null,
    input.owner || null,
    tags,
    metadata
  );

  return getProject(id)!;
}

export function getProject(id: string): Project | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | null;
  return row ? rowToProject(row) : null;
}

export interface ListProjectsOptions {
  status?: string;
  client?: string;
  owner?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listProjects(options: ListProjectsOptions = {}): Project[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.client) {
    conditions.push("client = ?");
    params.push(options.client);
  }

  if (options.owner) {
    conditions.push("owner = ?");
    params.push(options.owner);
  }

  if (options.search) {
    conditions.push(
      "(name LIKE ? OR description LIKE ? OR client LIKE ? OR owner LIKE ?)"
    );
    const q = `%${options.search}%`;
    params.push(q, q, q, q);
  }

  let sql = "SELECT * FROM projects";
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

  const rows = db.prepare(sql).all(...params) as ProjectRow[];
  return rows.map(rowToProject);
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  client?: string;
  status?: string;
  budget?: number;
  spent?: number;
  currency?: string;
  start_date?: string;
  end_date?: string;
  owner?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function updateProject(
  id: string,
  input: UpdateProjectInput
): Project | null {
  const db = getDatabase();
  const existing = getProject(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.client !== undefined) {
    sets.push("client = ?");
    params.push(input.client);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.budget !== undefined) {
    sets.push("budget = ?");
    params.push(input.budget);
  }
  if (input.spent !== undefined) {
    sets.push("spent = ?");
    params.push(input.spent);
  }
  if (input.currency !== undefined) {
    sets.push("currency = ?");
    params.push(input.currency);
  }
  if (input.start_date !== undefined) {
    sets.push("start_date = ?");
    params.push(input.start_date);
  }
  if (input.end_date !== undefined) {
    sets.push("end_date = ?");
    params.push(input.end_date);
  }
  if (input.owner !== undefined) {
    sets.push("owner = ?");
    params.push(input.owner);
  }
  if (input.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(input.tags));
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchProjects(query: string): Project[] {
  return listProjects({ search: query });
}

// --- Milestone CRUD ---

export interface CreateMilestoneInput {
  project_id: string;
  name: string;
  description?: string;
  due_date?: string;
  status?: string;
}

export function createMilestone(input: CreateMilestoneInput): Milestone {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO milestones (id, project_id, name, description, due_date, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.project_id,
    input.name,
    input.description || null,
    input.due_date || null,
    input.status || "pending"
  );

  return getMilestone(id)!;
}

export function getMilestone(id: string): Milestone | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as Milestone | null;
}

export interface ListMilestonesOptions {
  project_id?: string;
  status?: string;
}

export function listMilestones(options: ListMilestonesOptions = {}): Milestone[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.project_id) {
    conditions.push("project_id = ?");
    params.push(options.project_id);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM milestones";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY due_date ASC, created_at ASC";

  const rows = db.prepare(sql).all(...params) as Milestone[];
  return rows;
}

export interface UpdateMilestoneInput {
  name?: string;
  description?: string;
  due_date?: string;
  status?: string;
}

export function updateMilestone(
  id: string,
  input: UpdateMilestoneInput
): Milestone | null {
  const db = getDatabase();
  const existing = getMilestone(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.due_date !== undefined) {
    sets.push("due_date = ?");
    params.push(input.due_date);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
    if (input.status === "completed") {
      sets.push("completed_at = datetime('now')");
    }
  }

  if (sets.length === 0) return existing;
  params.push(id);

  db.prepare(
    `UPDATE milestones SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getMilestone(id);
}

export function completeMilestone(id: string): Milestone | null {
  return updateMilestone(id, { status: "completed" });
}

export function deleteMilestone(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM milestones WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Deliverable CRUD ---

export interface CreateDeliverableInput {
  milestone_id: string;
  name: string;
  description?: string;
  status?: string;
  assignee?: string;
  due_date?: string;
}

export function createDeliverable(input: CreateDeliverableInput): Deliverable {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO deliverables (id, milestone_id, name, description, status, assignee, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.milestone_id,
    input.name,
    input.description || null,
    input.status || "pending",
    input.assignee || null,
    input.due_date || null
  );

  return getDeliverable(id)!;
}

export function getDeliverable(id: string): Deliverable | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM deliverables WHERE id = ?").get(id) as Deliverable | null;
}

export interface ListDeliverablesOptions {
  milestone_id?: string;
  status?: string;
  assignee?: string;
}

export function listDeliverables(options: ListDeliverablesOptions = {}): Deliverable[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.milestone_id) {
    conditions.push("milestone_id = ?");
    params.push(options.milestone_id);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.assignee) {
    conditions.push("assignee = ?");
    params.push(options.assignee);
  }

  let sql = "SELECT * FROM deliverables";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY due_date ASC, created_at ASC";

  const rows = db.prepare(sql).all(...params) as Deliverable[];
  return rows;
}

export interface UpdateDeliverableInput {
  name?: string;
  description?: string;
  status?: string;
  assignee?: string;
  due_date?: string;
}

export function updateDeliverable(
  id: string,
  input: UpdateDeliverableInput
): Deliverable | null {
  const db = getDatabase();
  const existing = getDeliverable(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
    if (input.status === "completed") {
      sets.push("completed_at = datetime('now')");
    }
  }
  if (input.assignee !== undefined) {
    sets.push("assignee = ?");
    params.push(input.assignee);
  }
  if (input.due_date !== undefined) {
    sets.push("due_date = ?");
    params.push(input.due_date);
  }

  if (sets.length === 0) return existing;
  params.push(id);

  db.prepare(
    `UPDATE deliverables SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getDeliverable(id);
}

export function completeDeliverable(id: string): Deliverable | null {
  return updateDeliverable(id, { status: "completed" });
}

export function deleteDeliverable(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM deliverables WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Advanced Queries ---

export interface TimelineEntry {
  type: "milestone" | "deliverable";
  id: string;
  name: string;
  status: string;
  due_date: string | null;
  parent_id?: string;
  parent_name?: string;
}

export function getProjectTimeline(projectId: string): TimelineEntry[] {
  const db = getDatabase();

  const milestones = db.prepare(
    "SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date ASC, created_at ASC"
  ).all(projectId) as Milestone[];

  const entries: TimelineEntry[] = [];

  for (const m of milestones) {
    entries.push({
      type: "milestone",
      id: m.id,
      name: m.name,
      status: m.status,
      due_date: m.due_date,
    });

    const deliverables = db.prepare(
      "SELECT * FROM deliverables WHERE milestone_id = ? ORDER BY due_date ASC, created_at ASC"
    ).all(m.id) as Deliverable[];

    for (const d of deliverables) {
      entries.push({
        type: "deliverable",
        id: d.id,
        name: d.name,
        status: d.status,
        due_date: d.due_date,
        parent_id: m.id,
        parent_name: m.name,
      });
    }
  }

  return entries;
}

export interface BudgetReport {
  project_id: string;
  project_name: string;
  budget: number | null;
  spent: number;
  remaining: number | null;
  currency: string;
  utilization_pct: number | null;
}

export function getBudgetVsActual(projectId: string): BudgetReport | null {
  const project = getProject(projectId);
  if (!project) return null;

  return {
    project_id: project.id,
    project_name: project.name,
    budget: project.budget,
    spent: project.spent,
    remaining: project.budget !== null ? project.budget - project.spent : null,
    currency: project.currency,
    utilization_pct:
      project.budget !== null && project.budget > 0
        ? Math.round((project.spent / project.budget) * 10000) / 100
        : null,
  };
}

export function getOverdueProjects(): Project[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT * FROM projects
     WHERE end_date IS NOT NULL
       AND end_date < datetime('now')
       AND status NOT IN ('completed', 'cancelled')
     ORDER BY end_date ASC`
  ).all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function getOverdueMilestones(): Milestone[] {
  const db = getDatabase();
  return db.prepare(
    `SELECT * FROM milestones
     WHERE due_date IS NOT NULL
       AND due_date < datetime('now')
       AND status NOT IN ('completed', 'missed')
     ORDER BY due_date ASC`
  ).all() as Milestone[];
}

export interface ProjectStats {
  total: number;
  by_status: Record<string, number>;
  total_budget: number;
  total_spent: number;
}

export function getProjectStats(): ProjectStats {
  const db = getDatabase();

  const total = (
    db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number }
  ).count;

  const statusRows = db
    .prepare("SELECT status, COUNT(*) as count FROM projects GROUP BY status")
    .all() as { status: string; count: number }[];

  const by_status: Record<string, number> = {};
  for (const row of statusRows) {
    by_status[row.status] = row.count;
  }

  const budgetRow = db.prepare(
    "SELECT COALESCE(SUM(budget), 0) as total_budget, COALESCE(SUM(spent), 0) as total_spent FROM projects"
  ).get() as { total_budget: number; total_spent: number };

  return {
    total,
    by_status,
    total_budget: budgetRow.total_budget,
    total_spent: budgetRow.total_spent,
  };
}

export interface MilestoneProgress {
  project_id: string;
  total: number;
  completed: number;
  in_progress: number;
  pending: number;
  missed: number;
  completion_pct: number;
}

export function getMilestoneProgress(projectId: string): MilestoneProgress {
  const db = getDatabase();

  const rows = db
    .prepare(
      "SELECT status, COUNT(*) as count FROM milestones WHERE project_id = ? GROUP BY status"
    )
    .all(projectId) as { status: string; count: number }[];

  let total = 0;
  let completed = 0;
  let in_progress = 0;
  let pending = 0;
  let missed = 0;

  for (const row of rows) {
    total += row.count;
    if (row.status === "completed") completed = row.count;
    else if (row.status === "in_progress") in_progress = row.count;
    else if (row.status === "pending") pending = row.count;
    else if (row.status === "missed") missed = row.count;
  }

  return {
    project_id: projectId,
    total,
    completed,
    in_progress,
    pending,
    missed,
    completion_pct: total > 0 ? Math.round((completed / total) * 10000) / 100 : 0,
  };
}
