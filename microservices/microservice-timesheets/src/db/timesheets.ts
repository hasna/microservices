/**
 * Timesheet CRUD operations — projects and time entries
 */

import { getDatabase } from "./database.js";

// --- Project Types ---

export interface Project {
  id: string;
  name: string;
  client: string | null;
  hourly_rate: number;
  budget_hours: number;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  client?: string;
  hourly_rate?: number;
  budget_hours?: number;
  status?: "active" | "completed" | "archived";
}

export interface UpdateProjectInput {
  name?: string;
  client?: string | null;
  hourly_rate?: number;
  budget_hours?: number;
  status?: "active" | "completed" | "archived";
}

export interface ListProjectsOptions {
  status?: string;
  client?: string;
  limit?: number;
}

// --- Time Entry Types ---

export interface TimeEntry {
  id: string;
  project_id: string;
  description: string;
  date: string;
  hours: number;
  billable: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface TimeEntryRow {
  id: string;
  project_id: string;
  description: string;
  date: string;
  hours: number;
  billable: number;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToEntry(row: TimeEntryRow): TimeEntry {
  return {
    ...row,
    billable: row.billable === 1,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface LogTimeInput {
  project_id: string;
  description: string;
  date?: string;
  hours: number;
  billable?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateEntryInput {
  project_id?: string;
  description?: string;
  date?: string;
  hours?: number;
  billable?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ListEntriesOptions {
  project_id?: string;
  from_date?: string;
  to_date?: string;
  billable?: boolean;
  limit?: number;
}

// --- Project Summary Types ---

export interface ProjectSummary {
  project_id: string;
  project_name: string;
  client: string | null;
  hourly_rate: number;
  budget_hours: number;
  total_hours: number;
  billable_hours: number;
  non_billable_hours: number;
  total_value: number;
  budget_remaining: number;
}

export interface WeeklySummary {
  week_start: string;
  days: { date: string; hours: number; entries: number }[];
  total_hours: number;
  total_entries: number;
}

export interface ClientSummary {
  client: string;
  projects: number;
  total_hours: number;
  billable_hours: number;
  total_value: number;
}

// --- Project CRUD ---

export function createProject(input: CreateProjectInput): Project {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO projects (id, name, client, hourly_rate, budget_hours, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.client || null,
    input.hourly_rate || 0,
    input.budget_hours || 0,
    input.status || "active"
  );

  return getProject(id)!;
}

export function getProject(id: string): Project | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | null;
  return row || null;
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

  let sql = "SELECT * FROM projects";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY name";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  return db.prepare(sql).all(...params) as Project[];
}

export function updateProject(id: string, input: UpdateProjectInput): Project | null {
  const db = getDatabase();
  const existing = getProject(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.client !== undefined) {
    sets.push("client = ?");
    params.push(input.client);
  }
  if (input.hourly_rate !== undefined) {
    sets.push("hourly_rate = ?");
    params.push(input.hourly_rate);
  }
  if (input.budget_hours !== undefined) {
    sets.push("budget_hours = ?");
    params.push(input.budget_hours);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
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
  return db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
}

// --- Time Entry CRUD ---

export function logTime(input: LogTimeInput): TimeEntry {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const tags = JSON.stringify(input.tags || []);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO time_entries (id, project_id, description, date, hours, billable, tags, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.project_id,
    input.description,
    input.date || new Date().toISOString().split("T")[0],
    input.hours,
    input.billable !== false ? 1 : 0,
    tags,
    metadata
  );

  return getEntry(id)!;
}

export function getEntry(id: string): TimeEntry | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM time_entries WHERE id = ?").get(id) as TimeEntryRow | null;
  return row ? rowToEntry(row) : null;
}

export function listEntries(options: ListEntriesOptions = {}): TimeEntry[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.project_id) {
    conditions.push("project_id = ?");
    params.push(options.project_id);
  }
  if (options.from_date) {
    conditions.push("date >= ?");
    params.push(options.from_date);
  }
  if (options.to_date) {
    conditions.push("date <= ?");
    params.push(options.to_date);
  }
  if (options.billable !== undefined) {
    conditions.push("billable = ?");
    params.push(options.billable ? 1 : 0);
  }

  let sql = "SELECT * FROM time_entries";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY date DESC, created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params) as TimeEntryRow[];
  return rows.map(rowToEntry);
}

export function updateEntry(id: string, input: UpdateEntryInput): TimeEntry | null {
  const db = getDatabase();
  const existing = getEntry(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.project_id !== undefined) {
    sets.push("project_id = ?");
    params.push(input.project_id);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.date !== undefined) {
    sets.push("date = ?");
    params.push(input.date);
  }
  if (input.hours !== undefined) {
    sets.push("hours = ?");
    params.push(input.hours);
  }
  if (input.billable !== undefined) {
    sets.push("billable = ?");
    params.push(input.billable ? 1 : 0);
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
    `UPDATE time_entries SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getEntry(id);
}

export function deleteEntry(id: string): boolean {
  const db = getDatabase();
  return db.prepare("DELETE FROM time_entries WHERE id = ?").run(id).changes > 0;
}

// --- Summaries ---

export function getProjectSummary(projectId: string): ProjectSummary | null {
  const db = getDatabase();
  const project = getProject(projectId);
  if (!project) return null;

  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(hours), 0) as total_hours,
        COALESCE(SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END), 0) as billable_hours,
        COALESCE(SUM(CASE WHEN billable = 0 THEN hours ELSE 0 END), 0) as non_billable_hours
      FROM time_entries WHERE project_id = ?`
    )
    .get(projectId) as { total_hours: number; billable_hours: number; non_billable_hours: number };

  return {
    project_id: project.id,
    project_name: project.name,
    client: project.client,
    hourly_rate: project.hourly_rate,
    budget_hours: project.budget_hours,
    total_hours: row.total_hours,
    billable_hours: row.billable_hours,
    non_billable_hours: row.non_billable_hours,
    total_value: row.billable_hours * project.hourly_rate,
    budget_remaining: project.budget_hours > 0 ? project.budget_hours - row.total_hours : 0,
  };
}

export function getWeeklySummary(weekStart: string): WeeklySummary {
  const db = getDatabase();

  // Calculate week end (6 days after start)
  const start = new Date(weekStart);
  const days: { date: string; hours: number; entries: number }[] = [];

  let totalHours = 0;
  let totalEntries = 0;

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];

    const row = db
      .prepare(
        `SELECT
          COALESCE(SUM(hours), 0) as hours,
          COUNT(*) as entries
        FROM time_entries WHERE date = ?`
      )
      .get(dateStr) as { hours: number; entries: number };

    days.push({ date: dateStr, hours: row.hours, entries: row.entries });
    totalHours += row.hours;
    totalEntries += row.entries;
  }

  return {
    week_start: weekStart,
    days,
    total_hours: totalHours,
    total_entries: totalEntries,
  };
}

export function getClientSummary(): ClientSummary[] {
  const db = getDatabase();

  const rows = db
    .prepare(
      `SELECT
        COALESCE(p.client, 'No Client') as client,
        COUNT(DISTINCT p.id) as projects,
        COALESCE(SUM(te.hours), 0) as total_hours,
        COALESCE(SUM(CASE WHEN te.billable = 1 THEN te.hours ELSE 0 END), 0) as billable_hours,
        COALESCE(SUM(CASE WHEN te.billable = 1 THEN te.hours * p.hourly_rate ELSE 0 END), 0) as total_value
      FROM projects p
      LEFT JOIN time_entries te ON te.project_id = p.id
      GROUP BY COALESCE(p.client, 'No Client')
      ORDER BY total_value DESC`
    )
    .all() as ClientSummary[];

  return rows;
}
