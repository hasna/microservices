/**
 * Lead CRUD operations
 */

import { getDatabase } from "./database.js";

export interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  website: string | null;
  linkedin_url: string | null;
  source: string;
  status: string;
  score: number;
  score_reason: string | null;
  tags: string[];
  notes: string | null;
  metadata: Record<string, unknown>;
  enriched: boolean;
  enriched_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LeadRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  website: string | null;
  linkedin_url: string | null;
  source: string;
  status: string;
  score: number;
  score_reason: string | null;
  tags: string;
  notes: string | null;
  metadata: string;
  enriched: number;
  enriched_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToLead(row: LeadRow): Lead {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
    enriched: row.enriched === 1,
  };
}

export interface CreateLeadInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  website?: string;
  linkedin_url?: string;
  source?: string;
  status?: string;
  score?: number;
  score_reason?: string;
  tags?: string[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function createLead(input: CreateLeadInput): Lead {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const tags = JSON.stringify(input.tags || []);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO leads (id, name, email, phone, company, title, website, linkedin_url, source, status, score, score_reason, tags, notes, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name || null,
    input.email || null,
    input.phone || null,
    input.company || null,
    input.title || null,
    input.website || null,
    input.linkedin_url || null,
    input.source || "manual",
    input.status || "new",
    input.score || 0,
    input.score_reason || null,
    tags,
    input.notes || null,
    metadata
  );

  return getLead(id)!;
}

export function getLead(id: string): Lead | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as LeadRow | null;
  return row ? rowToLead(row) : null;
}

export interface UpdateLeadInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  website?: string;
  linkedin_url?: string;
  source?: string;
  status?: string;
  score?: number;
  score_reason?: string;
  tags?: string[];
  notes?: string;
  metadata?: Record<string, unknown>;
  enriched?: boolean;
  enriched_at?: string;
}

export function updateLead(id: string, input: UpdateLeadInput): Lead | null {
  const db = getDatabase();
  const existing = getLead(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.phone !== undefined) { sets.push("phone = ?"); params.push(input.phone); }
  if (input.company !== undefined) { sets.push("company = ?"); params.push(input.company); }
  if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title); }
  if (input.website !== undefined) { sets.push("website = ?"); params.push(input.website); }
  if (input.linkedin_url !== undefined) { sets.push("linkedin_url = ?"); params.push(input.linkedin_url); }
  if (input.source !== undefined) { sets.push("source = ?"); params.push(input.source); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.score !== undefined) { sets.push("score = ?"); params.push(input.score); }
  if (input.score_reason !== undefined) { sets.push("score_reason = ?"); params.push(input.score_reason); }
  if (input.tags !== undefined) { sets.push("tags = ?"); params.push(JSON.stringify(input.tags)); }
  if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes); }
  if (input.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }
  if (input.enriched !== undefined) { sets.push("enriched = ?"); params.push(input.enriched ? 1 : 0); }
  if (input.enriched_at !== undefined) { sets.push("enriched_at = ?"); params.push(input.enriched_at); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE leads SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getLead(id);
}

export function deleteLead(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM leads WHERE id = ?").run(id);
  return result.changes > 0;
}

export interface ListLeadsOptions {
  status?: string;
  source?: string;
  score_min?: number;
  score_max?: number;
  enriched?: boolean;
  limit?: number;
  offset?: number;
}

export function listLeads(options: ListLeadsOptions = {}): Lead[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.source) {
    conditions.push("source = ?");
    params.push(options.source);
  }
  if (options.score_min !== undefined) {
    conditions.push("score >= ?");
    params.push(options.score_min);
  }
  if (options.score_max !== undefined) {
    conditions.push("score <= ?");
    params.push(options.score_max);
  }
  if (options.enriched !== undefined) {
    conditions.push("enriched = ?");
    params.push(options.enriched ? 1 : 0);
  }

  let sql = "SELECT * FROM leads";
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

  const rows = db.prepare(sql).all(...params) as LeadRow[];
  return rows.map(rowToLead);
}

export function searchLeads(query: string): Lead[] {
  const db = getDatabase();
  const q = `%${query}%`;
  const rows = db
    .prepare(
      "SELECT * FROM leads WHERE name LIKE ? OR email LIKE ? OR company LIKE ? ORDER BY created_at DESC"
    )
    .all(q, q, q) as LeadRow[];
  return rows.map(rowToLead);
}

export function findByEmail(email: string): Lead | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM leads WHERE email = ?").get(email) as LeadRow | null;
  return row ? rowToLead(row) : null;
}

export interface BulkImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export function bulkImportLeads(data: CreateLeadInput[]): BulkImportResult {
  const result: BulkImportResult = { imported: 0, skipped: 0, errors: [] };

  for (const item of data) {
    try {
      // Dedup by email
      if (item.email) {
        const existing = findByEmail(item.email);
        if (existing) {
          result.skipped++;
          continue;
        }
      }
      createLead(item);
      result.imported++;
    } catch (error) {
      result.errors.push(
        `Failed to import ${item.email || item.name || "unknown"}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return result;
}

export function exportLeads(format: "csv" | "json", filters?: ListLeadsOptions): string {
  const leads = listLeads(filters || {});

  if (format === "json") {
    return JSON.stringify(leads, null, 2);
  }

  // CSV format
  const headers = [
    "id", "name", "email", "phone", "company", "title", "website",
    "linkedin_url", "source", "status", "score", "tags", "notes", "created_at",
  ];
  const rows = leads.map((lead) =>
    headers.map((h) => {
      const value = (lead as Record<string, unknown>)[h];
      if (Array.isArray(value)) return value.join(";");
      if (value === null || value === undefined) return "";
      const str = String(value);
      return str.includes(",") ? `"${str}"` : str;
    }).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  type: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface ActivityRow {
  id: string;
  lead_id: string;
  type: string;
  description: string | null;
  metadata: string;
  created_at: string;
}

function rowToActivity(row: ActivityRow): LeadActivity {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export function addActivity(
  leadId: string,
  type: string,
  description?: string,
  metadata?: Record<string, unknown>
): LeadActivity {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO lead_activities (id, lead_id, type, description, metadata)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, leadId, type, description || null, JSON.stringify(metadata || {}));

  const row = db.prepare("SELECT * FROM lead_activities WHERE id = ?").get(id) as ActivityRow;
  return rowToActivity(row);
}

export function getActivities(leadId: string, limit?: number): LeadActivity[] {
  const db = getDatabase();
  let sql = "SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY created_at DESC";
  const params: unknown[] = [leadId];

  if (limit) {
    sql += " LIMIT ?";
    params.push(limit);
  }

  const rows = db.prepare(sql).all(...params) as ActivityRow[];
  return rows.map(rowToActivity);
}

export function getLeadTimeline(leadId: string): LeadActivity[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY created_at ASC"
    )
    .all(leadId) as ActivityRow[];
  return rows.map(rowToActivity);
}

export interface LeadStats {
  total: number;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  avg_score: number;
  conversion_rate: number;
}

export function getLeadStats(): LeadStats {
  const db = getDatabase();

  const total = (db.prepare("SELECT COUNT(*) as count FROM leads").get() as { count: number }).count;

  const statusRows = db
    .prepare("SELECT status, COUNT(*) as count FROM leads GROUP BY status")
    .all() as { status: string; count: number }[];
  const by_status: Record<string, number> = {};
  for (const row of statusRows) {
    by_status[row.status] = row.count;
  }

  const sourceRows = db
    .prepare("SELECT source, COUNT(*) as count FROM leads GROUP BY source")
    .all() as { source: string; count: number }[];
  const by_source: Record<string, number> = {};
  for (const row of sourceRows) {
    by_source[row.source] = row.count;
  }

  const avgRow = db
    .prepare("SELECT AVG(score) as avg_score FROM leads")
    .get() as { avg_score: number | null };
  const avg_score = Math.round(avgRow.avg_score || 0);

  const converted = by_status["converted"] || 0;
  const conversion_rate = total > 0 ? Math.round((converted / total) * 100 * 100) / 100 : 0;

  return { total, by_status, by_source, avg_score, conversion_rate };
}

export interface PipelineStage {
  status: string;
  count: number;
  pct: number;
}

export function getPipeline(): PipelineStage[] {
  const db = getDatabase();
  const total = (db.prepare("SELECT COUNT(*) as count FROM leads").get() as { count: number }).count;

  const statuses = ["new", "contacted", "qualified", "unqualified", "converted", "lost"];
  const rows = db
    .prepare("SELECT status, COUNT(*) as count FROM leads GROUP BY status")
    .all() as { status: string; count: number }[];

  const countMap: Record<string, number> = {};
  for (const row of rows) {
    countMap[row.status] = row.count;
  }

  return statuses.map((status) => ({
    status,
    count: countMap[status] || 0,
    pct: total > 0 ? Math.round(((countMap[status] || 0) / total) * 100 * 100) / 100 : 0,
  }));
}

export interface DuplicatePair {
  lead1: Lead;
  lead2: Lead;
  email: string;
}

export function deduplicateLeads(): DuplicatePair[] {
  const db = getDatabase();
  // Find emails that appear more than once
  const dupes = db
    .prepare(
      "SELECT email FROM leads WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1"
    )
    .all() as { email: string }[];

  const pairs: DuplicatePair[] = [];
  for (const { email } of dupes) {
    const rows = db
      .prepare("SELECT * FROM leads WHERE email = ? ORDER BY created_at ASC")
      .all(email) as LeadRow[];
    const leads = rows.map(rowToLead);
    // Create pairs from first lead with each subsequent
    for (let i = 1; i < leads.length; i++) {
      pairs.push({ lead1: leads[0], lead2: leads[i], email });
    }
  }

  return pairs;
}

export function mergeLeads(keepId: string, mergeId: string): Lead | null {
  const db = getDatabase();
  const keep = getLead(keepId);
  const merge = getLead(mergeId);
  if (!keep || !merge) return null;

  // Merge data: fill in blanks from mergeId into keepId
  const updates: UpdateLeadInput = {};
  if (!keep.name && merge.name) updates.name = merge.name;
  if (!keep.email && merge.email) updates.email = merge.email;
  if (!keep.phone && merge.phone) updates.phone = merge.phone;
  if (!keep.company && merge.company) updates.company = merge.company;
  if (!keep.title && merge.title) updates.title = merge.title;
  if (!keep.website && merge.website) updates.website = merge.website;
  if (!keep.linkedin_url && merge.linkedin_url) updates.linkedin_url = merge.linkedin_url;

  // Merge tags
  const mergedTags = [...new Set([...keep.tags, ...merge.tags])];
  if (mergedTags.length > keep.tags.length) {
    updates.tags = mergedTags;
  }

  // Take higher score
  if (merge.score > keep.score) {
    updates.score = merge.score;
    updates.score_reason = merge.score_reason || keep.score_reason || undefined;
  }

  // Merge notes
  if (merge.notes && merge.notes !== keep.notes) {
    updates.notes = [keep.notes, merge.notes].filter(Boolean).join("\n---\n");
  }

  // Apply updates
  if (Object.keys(updates).length > 0) {
    updateLead(keepId, updates);
  }

  // Move activities from merge to keep
  db.prepare("UPDATE lead_activities SET lead_id = ? WHERE lead_id = ?").run(keepId, mergeId);

  // Move list memberships
  db.prepare(
    "UPDATE OR IGNORE lead_list_members SET lead_id = ? WHERE lead_id = ?"
  ).run(keepId, mergeId);

  // Delete the merged lead
  deleteLead(mergeId);

  // Log the merge
  addActivity(keepId, "note", `Merged with lead ${mergeId}`);

  return getLead(keepId);
}
