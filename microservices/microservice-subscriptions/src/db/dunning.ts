/**
 * Dunning attempts (failed payment retries)
 */

import { getDatabase } from "./database.js";

// --- Types ---

export interface DunningAttempt {
  id: string;
  subscriber_id: string;
  attempt_number: number;
  status: "pending" | "retrying" | "failed" | "recovered";
  next_retry_at: string | null;
  created_at: string;
}

interface DunningRow {
  id: string;
  subscriber_id: string;
  attempt_number: number;
  status: string;
  next_retry_at: string | null;
  created_at: string;
}

function rowToDunning(row: DunningRow): DunningAttempt {
  return {
    ...row,
    status: row.status as DunningAttempt["status"],
  };
}

// --- Dunning CRUD ---

export interface CreateDunningInput {
  subscriber_id: string;
  attempt_number?: number;
  status?: DunningAttempt["status"];
  next_retry_at?: string;
}

export function createDunning(input: CreateDunningInput): DunningAttempt {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const attemptNumber = input.attempt_number || 1;
  const status = input.status || "pending";
  const nextRetryAt = input.next_retry_at || null;

  db.prepare(
    `INSERT INTO dunning_attempts (id, subscriber_id, attempt_number, status, next_retry_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.subscriber_id, attemptNumber, status, nextRetryAt);

  return getDunning(id)!;
}

export function getDunning(id: string): DunningAttempt | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM dunning_attempts WHERE id = ?").get(id) as DunningRow | null;
  return row ? rowToDunning(row) : null;
}

export interface ListDunningOptions {
  subscriber_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listDunning(options: ListDunningOptions = {}): DunningAttempt[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.subscriber_id) {
    conditions.push("subscriber_id = ?");
    params.push(options.subscriber_id);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM dunning_attempts";
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

  const rows = db.prepare(sql).all(...params) as DunningRow[];
  return rows.map(rowToDunning);
}

export interface UpdateDunningInput {
  status?: DunningAttempt["status"];
  next_retry_at?: string | null;
}

export function updateDunning(id: string, input: UpdateDunningInput): DunningAttempt | null {
  const db = getDatabase();
  const existing = getDunning(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.next_retry_at !== undefined) {
    sets.push("next_retry_at = ?");
    params.push(input.next_retry_at);
  }

  if (sets.length === 0) return existing;

  params.push(id);

  db.prepare(
    `UPDATE dunning_attempts SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getDunning(id);
}
