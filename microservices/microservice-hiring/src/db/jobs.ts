/**
 * Job and Job Template CRUD operations
 */

import { getDatabase } from "./database.js";

// ---- Types ----

export interface Job {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  type: "full-time" | "part-time" | "contract";
  status: "open" | "closed" | "paused";
  description: string | null;
  requirements: string[];
  salary_range: string | null;
  posted_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface JobRow {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  type: string;
  status: string;
  description: string | null;
  requirements: string;
  salary_range: string | null;
  posted_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToJob(row: JobRow): Job {
  return {
    ...row,
    type: row.type as Job["type"],
    status: row.status as Job["status"],
    requirements: JSON.parse(row.requirements || "[]"),
  };
}

// ---- Jobs ----

export interface CreateJobInput {
  title: string;
  department?: string;
  location?: string;
  type?: "full-time" | "part-time" | "contract";
  description?: string;
  requirements?: string[];
  salary_range?: string;
  posted_at?: string;
}

export function createJob(input: CreateJobInput): Job {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const requirements = JSON.stringify(input.requirements || []);

  db.prepare(
    `INSERT INTO jobs (id, title, department, location, type, description, requirements, salary_range, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.department || null,
    input.location || null,
    input.type || "full-time",
    input.description || null,
    requirements,
    input.salary_range || null,
    input.posted_at || null
  );

  return getJob(id)!;
}

export function getJob(id: string): Job | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
  return row ? rowToJob(row) : null;
}

export interface ListJobsOptions {
  status?: string;
  department?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export function listJobs(options: ListJobsOptions = {}): Job[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.department) {
    conditions.push("department = ?");
    params.push(options.department);
  }
  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  let sql = "SELECT * FROM jobs";
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

  const rows = db.prepare(sql).all(...params) as JobRow[];
  return rows.map(rowToJob);
}

export interface UpdateJobInput {
  title?: string;
  department?: string;
  location?: string;
  type?: "full-time" | "part-time" | "contract";
  status?: "open" | "closed" | "paused";
  description?: string;
  requirements?: string[];
  salary_range?: string;
  posted_at?: string;
  closed_at?: string;
}

export function updateJob(id: string, input: UpdateJobInput): Job | null {
  const db = getDatabase();
  const existing = getJob(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title); }
  if (input.department !== undefined) { sets.push("department = ?"); params.push(input.department); }
  if (input.location !== undefined) { sets.push("location = ?"); params.push(input.location); }
  if (input.type !== undefined) { sets.push("type = ?"); params.push(input.type); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }
  if (input.requirements !== undefined) { sets.push("requirements = ?"); params.push(JSON.stringify(input.requirements)); }
  if (input.salary_range !== undefined) { sets.push("salary_range = ?"); params.push(input.salary_range); }
  if (input.posted_at !== undefined) { sets.push("posted_at = ?"); params.push(input.posted_at); }
  if (input.closed_at !== undefined) { sets.push("closed_at = ?"); params.push(input.closed_at); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getJob(id);
}

export function closeJob(id: string): Job | null {
  return updateJob(id, { status: "closed", closed_at: new Date().toISOString() });
}

export function deleteJob(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---- Job Templates ----

export interface JobTemplate {
  id: string;
  name: string;
  title: string;
  department: string | null;
  location: string | null;
  type: "full-time" | "part-time" | "contract";
  description: string | null;
  requirements: string[];
  salary_range: string | null;
  created_at: string;
  updated_at: string;
}

interface JobTemplateRow {
  id: string;
  name: string;
  title: string;
  department: string | null;
  location: string | null;
  type: string;
  description: string | null;
  requirements: string;
  salary_range: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJobTemplate(row: JobTemplateRow): JobTemplate {
  return {
    ...row,
    type: row.type as JobTemplate["type"],
    requirements: JSON.parse(row.requirements || "[]"),
  };
}

export function saveJobAsTemplate(jobId: string, templateName: string): JobTemplate {
  const db = getDatabase();
  const job = getJob(jobId);
  if (!job) throw new Error(`Job '${jobId}' not found`);

  const id = crypto.randomUUID();
  const requirements = JSON.stringify(job.requirements);

  db.prepare(
    `INSERT INTO job_templates (id, name, title, department, location, type, description, requirements, salary_range)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    templateName,
    job.title,
    job.department,
    job.location,
    job.type,
    job.description,
    requirements,
    job.salary_range
  );

  return getJobTemplate(id)!;
}

export function getJobTemplate(id: string): JobTemplate | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM job_templates WHERE id = ?").get(id) as JobTemplateRow | null;
  return row ? rowToJobTemplate(row) : null;
}

export function getJobTemplateByName(name: string): JobTemplate | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM job_templates WHERE name = ?").get(name) as JobTemplateRow | null;
  return row ? rowToJobTemplate(row) : null;
}

export function listJobTemplates(): JobTemplate[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM job_templates ORDER BY name ASC").all() as JobTemplateRow[];
  return rows.map(rowToJobTemplate);
}

export function createJobFromTemplate(templateName: string, overrides?: Partial<CreateJobInput>): Job {
  const template = getJobTemplateByName(templateName);
  if (!template) throw new Error(`Template '${templateName}' not found`);

  return createJob({
    title: overrides?.title || template.title,
    department: overrides?.department || template.department || undefined,
    location: overrides?.location || template.location || undefined,
    type: overrides?.type || template.type,
    description: overrides?.description || template.description || undefined,
    requirements: overrides?.requirements || template.requirements,
    salary_range: overrides?.salary_range || template.salary_range || undefined,
    posted_at: overrides?.posted_at,
  });
}

export function deleteJobTemplate(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM job_templates WHERE id = ?").run(id);
  return result.changes > 0;
}
