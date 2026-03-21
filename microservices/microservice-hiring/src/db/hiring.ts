/**
 * Hiring CRUD operations — jobs, applicants, interviews
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

export interface Applicant {
  id: string;
  job_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  resume_url: string | null;
  status: "applied" | "screening" | "interviewing" | "offered" | "hired" | "rejected";
  stage: string | null;
  rating: number | null;
  notes: string | null;
  source: string | null;
  applied_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ApplicantRow {
  id: string;
  job_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  resume_url: string | null;
  status: string;
  stage: string | null;
  rating: number | null;
  notes: string | null;
  source: string | null;
  applied_at: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface Interview {
  id: string;
  applicant_id: string;
  interviewer: string | null;
  scheduled_at: string | null;
  duration_min: number | null;
  type: "phone" | "video" | "onsite";
  status: "scheduled" | "completed" | "canceled";
  feedback: string | null;
  rating: number | null;
  created_at: string;
}

// ---- Row converters ----

function rowToJob(row: JobRow): Job {
  return {
    ...row,
    type: row.type as Job["type"],
    status: row.status as Job["status"],
    requirements: JSON.parse(row.requirements || "[]"),
  };
}

function rowToApplicant(row: ApplicantRow): Applicant {
  return {
    ...row,
    status: row.status as Applicant["status"],
    metadata: JSON.parse(row.metadata || "{}"),
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

// ---- Applicants ----

export interface CreateApplicantInput {
  job_id: string;
  name: string;
  email?: string;
  phone?: string;
  resume_url?: string;
  status?: Applicant["status"];
  stage?: string;
  rating?: number;
  notes?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export function createApplicant(input: CreateApplicantInput): Applicant {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO applicants (id, job_id, name, email, phone, resume_url, status, stage, rating, notes, source, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.job_id,
    input.name,
    input.email || null,
    input.phone || null,
    input.resume_url || null,
    input.status || "applied",
    input.stage || null,
    input.rating ?? null,
    input.notes || null,
    input.source || null,
    metadata
  );

  return getApplicant(id)!;
}

export function getApplicant(id: string): Applicant | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM applicants WHERE id = ?").get(id) as ApplicantRow | null;
  return row ? rowToApplicant(row) : null;
}

export interface ListApplicantsOptions {
  job_id?: string;
  status?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export function listApplicants(options: ListApplicantsOptions = {}): Applicant[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.job_id) {
    conditions.push("job_id = ?");
    params.push(options.job_id);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.source) {
    conditions.push("source = ?");
    params.push(options.source);
  }

  let sql = "SELECT * FROM applicants";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY applied_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as ApplicantRow[];
  return rows.map(rowToApplicant);
}

export interface UpdateApplicantInput {
  name?: string;
  email?: string;
  phone?: string;
  resume_url?: string;
  status?: Applicant["status"];
  stage?: string;
  rating?: number;
  notes?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export function updateApplicant(id: string, input: UpdateApplicantInput): Applicant | null {
  const db = getDatabase();
  const existing = getApplicant(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.phone !== undefined) { sets.push("phone = ?"); params.push(input.phone); }
  if (input.resume_url !== undefined) { sets.push("resume_url = ?"); params.push(input.resume_url); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.stage !== undefined) { sets.push("stage = ?"); params.push(input.stage); }
  if (input.rating !== undefined) { sets.push("rating = ?"); params.push(input.rating); }
  if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes); }
  if (input.source !== undefined) { sets.push("source = ?"); params.push(input.source); }
  if (input.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE applicants SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getApplicant(id);
}

export function advanceApplicant(id: string, newStatus: Applicant["status"]): Applicant | null {
  return updateApplicant(id, { status: newStatus });
}

export function rejectApplicant(id: string, reason?: string): Applicant | null {
  const input: UpdateApplicantInput = { status: "rejected" };
  if (reason) input.notes = reason;
  return updateApplicant(id, input);
}

export function deleteApplicant(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM applicants WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchApplicants(query: string): Applicant[] {
  const db = getDatabase();
  const q = `%${query}%`;
  const rows = db
    .prepare(
      "SELECT * FROM applicants WHERE name LIKE ? OR email LIKE ? OR notes LIKE ? OR source LIKE ? ORDER BY applied_at DESC"
    )
    .all(q, q, q, q) as ApplicantRow[];
  return rows.map(rowToApplicant);
}

export function listByStage(stage: string): Applicant[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM applicants WHERE stage = ? ORDER BY applied_at DESC")
    .all(stage) as ApplicantRow[];
  return rows.map(rowToApplicant);
}

export interface PipelineEntry {
  status: string;
  count: number;
}

export function getPipeline(jobId: string): PipelineEntry[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT status, COUNT(*) as count FROM applicants WHERE job_id = ? GROUP BY status ORDER BY CASE status WHEN 'applied' THEN 1 WHEN 'screening' THEN 2 WHEN 'interviewing' THEN 3 WHEN 'offered' THEN 4 WHEN 'hired' THEN 5 WHEN 'rejected' THEN 6 END"
    )
    .all(jobId) as PipelineEntry[];
  return rows;
}

export interface HiringStats {
  total_jobs: number;
  open_jobs: number;
  total_applicants: number;
  applicants_by_status: PipelineEntry[];
  total_interviews: number;
  avg_rating: number | null;
}

export function getHiringStats(): HiringStats {
  const db = getDatabase();

  const jobCount = db.prepare("SELECT COUNT(*) as count FROM jobs").get() as { count: number };
  const openJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'open'").get() as { count: number };
  const applicantCount = db.prepare("SELECT COUNT(*) as count FROM applicants").get() as { count: number };
  const interviewCount = db.prepare("SELECT COUNT(*) as count FROM interviews").get() as { count: number };
  const avgRating = db.prepare("SELECT AVG(rating) as avg FROM applicants WHERE rating IS NOT NULL").get() as { avg: number | null };

  const byStatus = db
    .prepare("SELECT status, COUNT(*) as count FROM applicants GROUP BY status")
    .all() as PipelineEntry[];

  return {
    total_jobs: jobCount.count,
    open_jobs: openJobs.count,
    total_applicants: applicantCount.count,
    applicants_by_status: byStatus,
    total_interviews: interviewCount.count,
    avg_rating: avgRating.avg ? Math.round(avgRating.avg * 10) / 10 : null,
  };
}

// ---- Interviews ----

export interface CreateInterviewInput {
  applicant_id: string;
  interviewer?: string;
  scheduled_at?: string;
  duration_min?: number;
  type?: "phone" | "video" | "onsite";
  status?: "scheduled" | "completed" | "canceled";
}

export function createInterview(input: CreateInterviewInput): Interview {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO interviews (id, applicant_id, interviewer, scheduled_at, duration_min, type, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.applicant_id,
    input.interviewer || null,
    input.scheduled_at || null,
    input.duration_min ?? null,
    input.type || "phone",
    input.status || "scheduled"
  );

  return getInterview(id)!;
}

export function getInterview(id: string): Interview | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM interviews WHERE id = ?").get(id) as Interview | null;
  return row || null;
}

export interface ListInterviewsOptions {
  applicant_id?: string;
  status?: string;
  type?: string;
  limit?: number;
}

export function listInterviews(options: ListInterviewsOptions = {}): Interview[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.applicant_id) {
    conditions.push("applicant_id = ?");
    params.push(options.applicant_id);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  let sql = "SELECT * FROM interviews";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY scheduled_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  return db.prepare(sql).all(...params) as Interview[];
}

export interface UpdateInterviewInput {
  interviewer?: string;
  scheduled_at?: string;
  duration_min?: number;
  type?: "phone" | "video" | "onsite";
  status?: "scheduled" | "completed" | "canceled";
  feedback?: string;
  rating?: number;
}

export function updateInterview(id: string, input: UpdateInterviewInput): Interview | null {
  const db = getDatabase();
  const existing = getInterview(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.interviewer !== undefined) { sets.push("interviewer = ?"); params.push(input.interviewer); }
  if (input.scheduled_at !== undefined) { sets.push("scheduled_at = ?"); params.push(input.scheduled_at); }
  if (input.duration_min !== undefined) { sets.push("duration_min = ?"); params.push(input.duration_min); }
  if (input.type !== undefined) { sets.push("type = ?"); params.push(input.type); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.feedback !== undefined) { sets.push("feedback = ?"); params.push(input.feedback); }
  if (input.rating !== undefined) { sets.push("rating = ?"); params.push(input.rating); }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE interviews SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getInterview(id);
}

export function addInterviewFeedback(id: string, feedback: string, rating?: number): Interview | null {
  const input: UpdateInterviewInput = { feedback, status: "completed" };
  if (rating !== undefined) input.rating = rating;
  return updateInterview(id, input);
}

export function deleteInterview(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM interviews WHERE id = ?").run(id);
  return result.changes > 0;
}
