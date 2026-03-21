import { getDatabase } from "./database.js";

export type IssueType = "spelling" | "grammar" | "punctuation" | "clarity";
export type IssueStatus = "pending" | "applied" | "dismissed";

export interface ProofreadIssue {
  id: string;
  transcript_id: string;
  issue_type: IssueType;
  position_start: number | null;
  position_end: number | null;
  original_text: string;
  suggestion: string | null;
  confidence: number | null;
  explanation: string | null;
  status: IssueStatus;
  created_at: string;
}

export interface CreateProofreadIssueInput {
  transcript_id: string;
  issue_type: IssueType;
  position_start?: number;
  position_end?: number;
  original_text: string;
  suggestion?: string;
  confidence?: number;
  explanation?: string;
}

export interface ListProofreadIssuesOptions {
  issue_type?: IssueType;
  status?: IssueStatus;
}

export function createProofreadIssue(input: CreateProofreadIssueInput): ProofreadIssue {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO proofread_issues (id, transcript_id, issue_type, position_start, position_end, original_text, suggestion, confidence, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.transcript_id,
    input.issue_type,
    input.position_start ?? null,
    input.position_end ?? null,
    input.original_text,
    input.suggestion ?? null,
    input.confidence ?? null,
    input.explanation ?? null
  );
  return getProofreadIssue(id)!;
}

export function getProofreadIssue(id: string): ProofreadIssue | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM proofread_issues WHERE id = ?").get(id) as ProofreadIssue | null;
  return row ?? null;
}

export function listProofreadIssues(transcriptId: string, options: ListProofreadIssuesOptions = {}): ProofreadIssue[] {
  const db = getDatabase();
  const conditions: string[] = ["transcript_id = ?"];
  const values: unknown[] = [transcriptId];

  if (options.issue_type) { conditions.push("issue_type = ?"); values.push(options.issue_type); }
  if (options.status) { conditions.push("status = ?"); values.push(options.status); }

  const where = conditions.join(" AND ");
  return db
    .prepare(`SELECT * FROM proofread_issues WHERE ${where} ORDER BY position_start ASC, created_at ASC`)
    .all(...values) as ProofreadIssue[];
}

export function updateIssueStatus(id: string, status: IssueStatus): ProofreadIssue | null {
  const db = getDatabase();
  const existing = getProofreadIssue(id);
  if (!existing) return null;
  db.prepare("UPDATE proofread_issues SET status = ? WHERE id = ?").run(status, id);
  return getProofreadIssue(id);
}

export function deleteProofreadIssuesByTranscript(transcriptId: string): number {
  const db = getDatabase();
  return db.prepare("DELETE FROM proofread_issues WHERE transcript_id = ?").run(transcriptId).changes;
}

export interface ProofreadStats {
  total: number;
  by_type: Record<string, number>;
  pending: number;
  applied: number;
  dismissed: number;
}

export function getProofreadStats(transcriptId: string): ProofreadStats {
  const db = getDatabase();

  const total = (db.prepare("SELECT COUNT(*) as n FROM proofread_issues WHERE transcript_id = ?").get(transcriptId) as { n: number }).n;

  const byType = db
    .prepare("SELECT issue_type, COUNT(*) as n FROM proofread_issues WHERE transcript_id = ? GROUP BY issue_type")
    .all(transcriptId) as { issue_type: string; n: number }[];

  const byStatus = db
    .prepare("SELECT status, COUNT(*) as n FROM proofread_issues WHERE transcript_id = ? GROUP BY status")
    .all(transcriptId) as { status: string; n: number }[];

  const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));

  return {
    total,
    by_type: Object.fromEntries(byType.map((r) => [r.issue_type, r.n])),
    pending: statusMap["pending"] ?? 0,
    applied: statusMap["applied"] ?? 0,
    dismissed: statusMap["dismissed"] ?? 0,
  };
}
