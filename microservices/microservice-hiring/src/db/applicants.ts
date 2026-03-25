/**
 * Applicant CRUD operations and pipeline management
 */

import { getDatabase } from "./database.js";

// ---- Types ----

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

export function rowToApplicant(row: ApplicantRow): Applicant {
  return {
    ...row,
    status: row.status as Applicant["status"],
    metadata: JSON.parse(row.metadata || "{}"),
  };
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

// ---- Bulk Import ----

export interface BulkImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export function bulkImportApplicants(csvData: string, getJobFn: (id: string) => unknown): BulkImportResult {
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

    const job = getJobFn(jobId);
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
