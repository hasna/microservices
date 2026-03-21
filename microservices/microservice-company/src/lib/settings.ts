/**
 * Company settings — key/value configuration per organization
 */

import { getDatabase } from "../db/database.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompanySetting {
  id: string;
  org_id: string | null;
  key: string;
  value: string;
  category: string | null;
}

// ─── Operations ──────────────────────────────────────────────────────────────

export function getSetting(orgId: string | null, key: string): CompanySetting | null {
  const db = getDatabase();
  const row = db.prepare(
    "SELECT * FROM company_settings WHERE org_id IS ? AND key = ?"
  ).get(orgId, key) as CompanySetting | null;
  return row;
}

export function setSetting(
  orgId: string | null,
  key: string,
  value: string,
  category?: string
): CompanySetting {
  const db = getDatabase();
  const existing = getSetting(orgId, key);

  if (existing) {
    db.prepare(
      "UPDATE company_settings SET value = ?, category = COALESCE(?, category) WHERE id = ?"
    ).run(value, category || null, existing.id);
    return getSetting(orgId, key)!;
  }

  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO company_settings (id, org_id, key, value, category) VALUES (?, ?, ?, ?, ?)"
  ).run(id, orgId, key, value, category || null);

  return getSetting(orgId, key)!;
}

export function getAllSettings(orgId: string | null, category?: string): CompanySetting[] {
  const db = getDatabase();
  const conditions: string[] = ["org_id IS ?"];
  const params: unknown[] = [orgId];

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }

  const sql = `SELECT * FROM company_settings WHERE ${conditions.join(" AND ")} ORDER BY key`;
  return db.prepare(sql).all(...params) as CompanySetting[];
}

export function deleteSetting(orgId: string | null, key: string): boolean {
  const db = getDatabase();
  const result = db.prepare(
    "DELETE FROM company_settings WHERE org_id IS ? AND key = ?"
  ).run(orgId, key);
  return result.changes > 0;
}

export interface BulkSettingEntry {
  key: string;
  value: string;
  category?: string;
}

export function bulkSetSettings(orgId: string | null, entries: BulkSettingEntry[]): CompanySetting[] {
  const results: CompanySetting[] = [];
  for (const entry of entries) {
    results.push(setSetting(orgId, entry.key, entry.value, entry.category));
  }
  return results;
}
