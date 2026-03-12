/**
 * Company CRUD operations
 */

import { getDatabase } from "./database.js";

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  notes: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToCompany(row: CompanyRow): Company {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateCompanyInput {
  name: string;
  domain?: string;
  industry?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function createCompany(input: CreateCompanyInput): Company {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO companies (id, name, domain, industry, notes, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.name, input.domain || null, input.industry || null, input.notes || null, metadata);

  return getCompany(id)!;
}

export function getCompany(id: string): Company | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as CompanyRow | null;
  return row ? rowToCompany(row) : null;
}

export interface ListCompaniesOptions {
  search?: string;
  industry?: string;
  limit?: number;
  offset?: number;
}

export function listCompanies(options: ListCompaniesOptions = {}): Company[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push("(name LIKE ? OR domain LIKE ? OR industry LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  if (options.industry) {
    conditions.push("industry = ?");
    params.push(options.industry);
  }

  let sql = "SELECT * FROM companies";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY name";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as CompanyRow[];
  return rows.map(rowToCompany);
}

export interface UpdateCompanyInput {
  name?: string;
  domain?: string;
  industry?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function updateCompany(
  id: string,
  input: UpdateCompanyInput
): Company | null {
  const db = getDatabase();
  const existing = getCompany(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.domain !== undefined) {
    sets.push("domain = ?");
    params.push(input.domain);
  }
  if (input.industry !== undefined) {
    sets.push("industry = ?");
    params.push(input.industry);
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

  db.prepare(
    `UPDATE companies SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getCompany(id);
}

export function deleteCompany(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM companies WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countCompanies(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM companies").get() as { count: number };
  return row.count;
}
