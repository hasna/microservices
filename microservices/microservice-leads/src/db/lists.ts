/**
 * Lead list operations
 */

import { getDatabase } from "./database.js";
import type { Lead } from "./leads.js";

export interface LeadList {
  id: string;
  name: string;
  description: string | null;
  filter_query: string | null;
  created_at: string;
}

export interface CreateListInput {
  name: string;
  description?: string;
  filter_query?: string;
}

export function createList(input: CreateListInput): LeadList {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO lead_lists (id, name, description, filter_query) VALUES (?, ?, ?, ?)`
  ).run(id, input.name, input.description || null, input.filter_query || null);

  return getList(id)!;
}

export function getList(id: string): LeadList | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM lead_lists WHERE id = ?").get(id) as LeadList | null;
}

export function listLists(): LeadList[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM lead_lists ORDER BY created_at DESC").all() as LeadList[];
}

export function deleteList(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM lead_lists WHERE id = ?").run(id);
  return result.changes > 0;
}

export function addToList(listId: string, leadId: string): boolean {
  const db = getDatabase();
  try {
    db.prepare(
      "INSERT OR IGNORE INTO lead_list_members (lead_list_id, lead_id) VALUES (?, ?)"
    ).run(listId, leadId);
    return true;
  } catch {
    return false;
  }
}

export function removeFromList(listId: string, leadId: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM lead_list_members WHERE lead_list_id = ? AND lead_id = ?")
    .run(listId, leadId);
  return result.changes > 0;
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

export function getListMembers(listId: string): Lead[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT l.* FROM leads l
       JOIN lead_list_members m ON l.id = m.lead_id
       WHERE m.lead_list_id = ?
       ORDER BY m.added_at DESC`
    )
    .all(listId) as LeadRow[];
  return rows.map(rowToLead);
}

export function getSmartListMembers(listId: string): Lead[] {
  const db = getDatabase();
  const list = getList(listId);
  if (!list) return [];

  // If no filter_query, return regular members
  if (!list.filter_query) {
    return getListMembers(listId);
  }

  // Parse simple filter queries like "status=qualified AND score>=50"
  const conditions: string[] = [];
  const params: unknown[] = [];

  const filters = list.filter_query.split(/\s+AND\s+/i);
  for (const filter of filters) {
    const match = filter.match(/^(\w+)\s*(=|>=|<=|>|<|!=)\s*(.+)$/);
    if (match) {
      const [, field, op, value] = match;
      conditions.push(`${field} ${op} ?`);
      // Try numeric parse
      const num = Number(value);
      params.push(isNaN(num) ? value : num);
    }
  }

  if (conditions.length === 0) {
    return getListMembers(listId);
  }

  const sql = `SELECT * FROM leads WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;
  try {
    const rows = db.prepare(sql).all(...params) as LeadRow[];
    return rows.map(rowToLead);
  } catch {
    // If filter query is invalid, fall back to regular members
    return getListMembers(listId);
  }
}
