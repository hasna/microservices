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

// ---- Bulk Import ----

export interface BulkImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export function bulkImportApplicants(csvData: string): BulkImportResult {
  const lines = csvData.trim().split("\n");
  if (lines.length < 2) {
    return { imported: 0, skipped: 0, errors: ["CSV must have a header row and at least one data row"] };
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const requiredCols = ["name"];
  for (const col of requiredCols) {
    if (!header.includes(col)) {
      return { imported: 0, skipped: 0, errors: [`Missing required column: ${col}`] };
    }
  }

  const nameIdx = header.indexOf("name");
  const emailIdx = header.indexOf("email");
  const phoneIdx = header.indexOf("phone");
  const jobIdIdx = header.indexOf("job_id");
  const sourceIdx = header.indexOf("source");
  const resumeUrlIdx = header.indexOf("resume_url");

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { skipped++; continue; }

    const cols = parseCsvLine(line);
    const name = cols[nameIdx]?.trim();

    if (!name) {
      errors.push(`Row ${i + 1}: missing name`);
      skipped++;
      continue;
    }

    const jobId = jobIdIdx >= 0 ? cols[jobIdIdx]?.trim() : undefined;
    if (!jobId) {
      errors.push(`Row ${i + 1}: missing job_id`);
      skipped++;
      continue;
    }

    // Verify job exists
    const job = getJob(jobId);
    if (!job) {
      errors.push(`Row ${i + 1}: job '${jobId}' not found`);
      skipped++;
      continue;
    }

    try {
      createApplicant({
        name,
        job_id: jobId,
        email: emailIdx >= 0 ? cols[emailIdx]?.trim() || undefined : undefined,
        phone: phoneIdx >= 0 ? cols[phoneIdx]?.trim() || undefined : undefined,
        source: sourceIdx >= 0 ? cols[sourceIdx]?.trim() || undefined : undefined,
        resume_url: resumeUrlIdx >= 0 ? cols[resumeUrlIdx]?.trim() || undefined : undefined,
      });
      imported++;
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ---- Offer Letter Generation ----

export interface OfferDetails {
  salary: number;
  start_date: string;
  position_title?: string;
  department?: string;
  benefits?: string;
  equity?: string;
  signing_bonus?: number;
}

export function generateOffer(applicantId: string, details: OfferDetails): string {
  const applicant = getApplicant(applicantId);
  if (!applicant) throw new Error(`Applicant '${applicantId}' not found`);

  const job = getJob(applicant.job_id);
  if (!job) throw new Error(`Job '${applicant.job_id}' not found`);

  const title = details.position_title || job.title;
  const dept = details.department || job.department || "the team";
  const salary = details.salary.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  let letter = `# Offer Letter

**Date:** ${new Date().toISOString().split("T")[0]}

Dear **${applicant.name}**,

We are pleased to extend an offer of employment for the position of **${title}** in **${dept}**.

## Terms of Employment

| Detail | Value |
|--------|-------|
| **Position** | ${title} |
| **Department** | ${dept} |
| **Annual Salary** | ${salary} |
| **Start Date** | ${details.start_date} |
| **Employment Type** | ${job.type} |`;

  if (details.signing_bonus) {
    const bonus = details.signing_bonus.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    letter += `\n| **Signing Bonus** | ${bonus} |`;
  }

  if (details.equity) {
    letter += `\n| **Equity** | ${details.equity} |`;
  }

  if (details.benefits) {
    letter += `\n\n## Benefits\n\n${details.benefits}`;
  }

  letter += `

## Next Steps

Please review this offer carefully. To accept, please sign and return this letter by **${getResponseDeadline(details.start_date)}**.

We are excited to have you join ${dept} and look forward to your contributions.

Sincerely,
**Hiring Team**
`;

  // Store offer in applicant metadata
  const metadata = {
    ...applicant.metadata,
    offer: { ...details, generated_at: new Date().toISOString() },
  };
  updateApplicant(applicantId, { metadata, status: "offered" });

  return letter;
}

function getResponseDeadline(startDate: string): string {
  const start = new Date(startDate);
  const deadline = new Date(start.getTime() - 14 * 24 * 60 * 60 * 1000);
  return deadline.toISOString().split("T")[0];
}

// ---- Pipeline Velocity / Hiring Forecast ----

export interface HiringForecast {
  job_id: string;
  job_title: string;
  total_applicants: number;
  current_pipeline: PipelineEntry[];
  avg_days_per_stage: Record<string, number>;
  estimated_days_to_fill: number | null;
  conversion_rates: Record<string, number>;
}

export function getHiringForecast(jobId: string): HiringForecast {
  const db = getDatabase();
  const job = getJob(jobId);
  if (!job) throw new Error(`Job '${jobId}' not found`);

  const pipeline = getPipeline(jobId);
  const applicants = listApplicants({ job_id: jobId });

  // Calculate stage transition times from applicant update timestamps
  const stages = ["applied", "screening", "interviewing", "offered", "hired"];
  const stageDurations: Record<string, number[]> = {};

  for (const applicant of applicants) {
    // Use created_at and updated_at to estimate stage duration
    if (applicant.status !== "applied" && applicant.status !== "rejected") {
      const created = new Date(applicant.created_at).getTime();
      const updated = new Date(applicant.updated_at).getTime();
      const days = (updated - created) / (1000 * 60 * 60 * 24);
      if (days > 0) {
        const key = `applied->${applicant.status}`;
        if (!stageDurations[key]) stageDurations[key] = [];
        stageDurations[key].push(days);
      }
    }
  }

  const avgDaysPerStage: Record<string, number> = {};
  for (const [key, durations] of Object.entries(stageDurations)) {
    avgDaysPerStage[key] = Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;
  }

  // Calculate conversion rates between stages
  const conversionRates: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  for (const p of pipeline) {
    statusCounts[p.status] = p.count;
  }

  const total = applicants.length;
  if (total > 0) {
    for (const stage of stages) {
      const atOrPast = applicants.filter((a) => {
        const idx = stages.indexOf(a.status);
        const stageIdx = stages.indexOf(stage);
        return idx >= stageIdx && a.status !== "rejected";
      }).length;
      conversionRates[stage] = Math.round((atOrPast / total) * 100);
    }
  }

  // Estimate days to fill: sum of avg days per stage transition for the full pipeline
  let estimatedDays: number | null = null;
  if (Object.keys(avgDaysPerStage).length > 0) {
    // Use the longest observed transition as an estimate
    const values = Object.values(avgDaysPerStage);
    estimatedDays = Math.round(values.reduce((a, b) => Math.max(a, b), 0) * 1.2);
  } else if (applicants.length > 0) {
    // Fallback: estimate based on overall pipeline age
    const oldest = applicants.reduce((oldest, a) => {
      const t = new Date(a.created_at).getTime();
      return t < oldest ? t : oldest;
    }, Date.now());
    const daysSinceFirst = (Date.now() - oldest) / (1000 * 60 * 60 * 24);
    const hiredCount = statusCounts["hired"] || 0;
    if (hiredCount > 0) {
      estimatedDays = Math.round(daysSinceFirst / hiredCount);
    } else {
      estimatedDays = Math.round(daysSinceFirst * 2);
    }
  }

  return {
    job_id: jobId,
    job_title: job.title,
    total_applicants: total,
    current_pipeline: pipeline,
    avg_days_per_stage: avgDaysPerStage,
    estimated_days_to_fill: estimatedDays,
    conversion_rates: conversionRates,
  };
}

// ---- Structured Interview Feedback ----

export interface StructuredFeedback {
  technical?: number;
  communication?: number;
  culture_fit?: number;
  problem_solving?: number;
  leadership?: number;
  overall?: number;
  notes?: string;
}

export function submitStructuredFeedback(
  interviewId: string,
  scores: StructuredFeedback,
  feedbackText?: string
): Interview | null {
  const interview = getInterview(interviewId);
  if (!interview) return null;

  // Build feedback JSON with scores and text
  const feedbackData = {
    scores,
    text: feedbackText || interview.feedback || "",
    submitted_at: new Date().toISOString(),
  };

  // Calculate average score from provided dimensions
  const scoreValues = [
    scores.technical,
    scores.communication,
    scores.culture_fit,
    scores.problem_solving,
    scores.leadership,
    scores.overall,
  ].filter((v): v is number => v !== undefined);

  const avgRating = scoreValues.length > 0
    ? Math.round((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) * 10) / 10
    : undefined;

  return updateInterview(interviewId, {
    feedback: JSON.stringify(feedbackData),
    rating: avgRating,
    status: "completed",
  });
}

// ---- Bulk Rejection ----

export interface BulkRejectResult {
  rejected: number;
  applicant_ids: string[];
}

export function bulkReject(
  jobId: string,
  status: Applicant["status"],
  reason?: string
): BulkRejectResult {
  const applicants = listApplicants({ job_id: jobId, status });
  const rejected: string[] = [];

  for (const applicant of applicants) {
    const result = rejectApplicant(applicant.id, reason);
    if (result) rejected.push(applicant.id);
  }

  return { rejected: rejected.length, applicant_ids: rejected };
}

// ---- Referral Stats ----

export interface ReferralStats {
  source: string;
  total: number;
  hired: number;
  rejected: number;
  in_progress: number;
  conversion_rate: number;
}

export function getReferralStats(): ReferralStats[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT
      COALESCE(source, 'unknown') as source,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'hired' THEN 1 ELSE 0 END) as hired,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status NOT IN ('hired', 'rejected') THEN 1 ELSE 0 END) as in_progress
    FROM applicants
    GROUP BY COALESCE(source, 'unknown')
    ORDER BY total DESC
  `).all() as Array<{
    source: string;
    total: number;
    hired: number;
    rejected: number;
    in_progress: number;
  }>;

  return rows.map((r) => ({
    ...r,
    conversion_rate: r.total > 0 ? Math.round((r.hired / r.total) * 100 * 10) / 10 : 0,
  }));
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
