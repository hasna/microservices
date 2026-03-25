/**
 * Failed payment retry operations
 */

import { getDatabase } from "./database.js";
import { getPayment, updatePayment } from "./payments-core.js";

// --- Failed Payment Retry ---

export type RetryStatus = "pending" | "retrying" | "succeeded" | "failed";

export interface RetryAttempt {
  id: string;
  payment_id: string;
  attempt: number;
  status: RetryStatus;
  attempted_at: string | null;
  error: string | null;
  created_at: string;
}

interface RetryAttemptRow {
  id: string;
  payment_id: string;
  attempt: number;
  status: string;
  attempted_at: string | null;
  error: string | null;
  created_at: string;
}

function rowToRetryAttempt(row: RetryAttemptRow): RetryAttempt {
  return {
    ...row,
    status: row.status as RetryStatus,
  };
}

export function retryPayment(paymentId: string): RetryAttempt | null {
  const db = getDatabase();
  const payment = getPayment(paymentId);
  if (!payment) return null;
  if (payment.status !== "failed") return null;

  const lastAttempt = db
    .prepare(
      "SELECT MAX(attempt) as max_attempt FROM retry_attempts WHERE payment_id = ?"
    )
    .get(paymentId) as { max_attempt: number | null };

  const attemptNum = (lastAttempt?.max_attempt || 0) + 1;
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO retry_attempts (id, payment_id, attempt, status, attempted_at)
     VALUES (?, ?, ?, 'retrying', datetime('now'))`
  ).run(id, paymentId, attemptNum);

  // Simulate retry — mark as succeeded (in a real system, this would call the provider)
  db.prepare(
    `UPDATE retry_attempts SET status = 'succeeded', attempted_at = datetime('now') WHERE id = ?`
  ).run(id);

  updatePayment(paymentId, { status: "succeeded", completed_at: new Date().toISOString() });

  return getRetryAttempt(id);
}

function getRetryAttempt(id: string): RetryAttempt | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM retry_attempts WHERE id = ?").get(id) as RetryAttemptRow | null;
  return row ? rowToRetryAttempt(row) : null;
}

export function listRetries(paymentId: string): RetryAttempt[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM retry_attempts WHERE payment_id = ? ORDER BY attempt ASC")
    .all(paymentId) as RetryAttemptRow[];
  return rows.map(rowToRetryAttempt);
}

export interface RetryStats {
  total_retries: number;
  succeeded: number;
  failed: number;
  pending: number;
  retrying: number;
  success_rate: number;
}

export function getRetryStats(): RetryStats {
  const db = getDatabase();
  const total = db.prepare("SELECT COUNT(*) as count FROM retry_attempts").get() as { count: number };
  const statusRows = db
    .prepare("SELECT status, COUNT(*) as count FROM retry_attempts GROUP BY status")
    .all() as { status: string; count: number }[];

  const statusCounts: Record<string, number> = {};
  for (const r of statusRows) statusCounts[r.status] = r.count;

  const succeeded = statusCounts["succeeded"] || 0;
  const totalCount = total.count || 0;

  return {
    total_retries: totalCount,
    succeeded,
    failed: statusCounts["failed"] || 0,
    pending: statusCounts["pending"] || 0,
    retrying: statusCounts["retrying"] || 0,
    success_rate: totalCount > 0 ? (succeeded / totalCount) * 100 : 0,
  };
}
