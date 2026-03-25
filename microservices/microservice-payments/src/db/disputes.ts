/**
 * Dispute CRUD operations and evidence management
 */

import { getDatabase } from "./database.js";
import { updatePayment } from "./payments-core.js";

// --- Disputes ---

export type DisputeStatus = "open" | "under_review" | "won" | "lost";

export interface Dispute {
  id: string;
  payment_id: string;
  reason: string | null;
  status: DisputeStatus;
  amount: number | null;
  evidence: Record<string, unknown>;
  opened_at: string;
  resolved_at: string | null;
  created_at: string;
}

interface DisputeRow {
  id: string;
  payment_id: string;
  reason: string | null;
  status: string;
  amount: number | null;
  evidence: string;
  opened_at: string;
  resolved_at: string | null;
  created_at: string;
}

function rowToDispute(row: DisputeRow): Dispute {
  return {
    ...row,
    status: row.status as DisputeStatus,
    evidence: JSON.parse(row.evidence || "{}"),
  };
}

export interface CreateDisputeInput {
  payment_id: string;
  reason?: string;
  amount?: number;
  evidence?: Record<string, unknown>;
}

export function createDispute(input: CreateDisputeInput): Dispute {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const evidence = JSON.stringify(input.evidence || {});

  db.prepare(
    `INSERT INTO disputes (id, payment_id, reason, amount, evidence)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.payment_id, input.reason || null, input.amount || null, evidence);

  // Mark the payment as disputed
  updatePayment(input.payment_id, { status: "disputed" });

  return getDispute(id)!;
}

export function getDispute(id: string): Dispute | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM disputes WHERE id = ?").get(id) as DisputeRow | null;
  return row ? rowToDispute(row) : null;
}

export function listDisputes(status?: DisputeStatus): Dispute[] {
  const db = getDatabase();
  let sql = "SELECT * FROM disputes";
  const params: unknown[] = [];

  if (status) {
    sql += " WHERE status = ?";
    params.push(status);
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as DisputeRow[];
  return rows.map(rowToDispute);
}

export interface RespondDisputeInput {
  status: DisputeStatus;
  evidence?: Record<string, unknown>;
}

export function respondDispute(id: string, input: RespondDisputeInput): Dispute | null {
  const db = getDatabase();
  const existing = getDispute(id);
  if (!existing) return null;

  const sets: string[] = ["status = ?"];
  const params: unknown[] = [input.status];

  if (input.evidence) {
    sets.push("evidence = ?");
    params.push(JSON.stringify(input.evidence));
  }

  if (input.status === "won" || input.status === "lost") {
    sets.push("resolved_at = datetime('now')");
  }

  params.push(id);
  db.prepare(`UPDATE disputes SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getDispute(id);
}

export function deleteDispute(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM disputes WHERE id = ?").run(id);
  return result.changes > 0;
}

export function addDisputeEvidence(
  disputeId: string,
  description: string,
  fileRef?: string
): Dispute | null {
  const db = getDatabase();
  const dispute = getDispute(disputeId);
  if (!dispute) return null;

  const evidence = dispute.evidence as Record<string, unknown>;
  const items = Array.isArray(evidence.items) ? [...evidence.items] : [];

  const entry: Record<string, unknown> = {
    description,
    added_at: new Date().toISOString(),
  };
  if (fileRef) {
    entry.file_ref = fileRef;
  }
  items.push(entry);

  const newEvidence = { ...evidence, items };
  db.prepare("UPDATE disputes SET evidence = ? WHERE id = ?").run(
    JSON.stringify(newEvidence),
    disputeId
  );

  return getDispute(disputeId);
}
