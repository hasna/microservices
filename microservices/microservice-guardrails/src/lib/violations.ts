/**
 * Violation logging and querying.
 */

import type { Sql } from "postgres";

export interface Violation {
  id: string;
  workspace_id: string | null;
  type: string;
  direction: string;
  content_snippet: string | null;
  details: any;
  severity: string;
  created_at: Date;
}

export async function logViolation(
  sql: Sql,
  opts: {
    workspaceId?: string;
    type: string;
    direction: "input" | "output";
    contentSnippet?: string;
    details?: any;
    severity?: string;
  },
): Promise<Violation> {
  const snippet = opts.contentSnippet
    ? opts.contentSnippet.slice(0, 200)
    : null;
  const [row] = await sql`
    INSERT INTO guardrails.violations (workspace_id, type, direction, content_snippet, details, severity)
    VALUES (${opts.workspaceId ?? null}, ${opts.type}, ${opts.direction}, ${snippet}, ${JSON.stringify(opts.details ?? {})}, ${opts.severity ?? "medium"})
    RETURNING *
  `;
  return row as unknown as Violation;
}

export async function listViolations(
  sql: Sql,
  filters: {
    workspaceId?: string;
    type?: string;
    severity?: string;
    limit?: number;
  },
): Promise<Violation[]> {
  const limit = filters.limit ?? 50;

  if (filters.workspaceId && filters.type && filters.severity) {
    return (await sql`
      SELECT * FROM guardrails.violations
      WHERE workspace_id = ${filters.workspaceId}
        AND type = ${filters.type}
        AND severity = ${filters.severity}
      ORDER BY created_at DESC LIMIT ${limit}
    `) as unknown as Violation[];
  }
  if (filters.workspaceId && filters.type) {
    return (await sql`
      SELECT * FROM guardrails.violations
      WHERE workspace_id = ${filters.workspaceId} AND type = ${filters.type}
      ORDER BY created_at DESC LIMIT ${limit}
    `) as unknown as Violation[];
  }
  if (filters.workspaceId && filters.severity) {
    return (await sql`
      SELECT * FROM guardrails.violations
      WHERE workspace_id = ${filters.workspaceId} AND severity = ${filters.severity}
      ORDER BY created_at DESC LIMIT ${limit}
    `) as unknown as Violation[];
  }
  if (filters.workspaceId) {
    return (await sql`
      SELECT * FROM guardrails.violations
      WHERE workspace_id = ${filters.workspaceId}
      ORDER BY created_at DESC LIMIT ${limit}
    `) as unknown as Violation[];
  }
  if (filters.type) {
    return (await sql`
      SELECT * FROM guardrails.violations
      WHERE type = ${filters.type}
      ORDER BY created_at DESC LIMIT ${limit}
    `) as unknown as Violation[];
  }
  if (filters.severity) {
    return (await sql`
      SELECT * FROM guardrails.violations
      WHERE severity = ${filters.severity}
      ORDER BY created_at DESC LIMIT ${limit}
    `) as unknown as Violation[];
  }

  return (await sql`
    SELECT * FROM guardrails.violations
    ORDER BY created_at DESC LIMIT ${limit}
  `) as unknown as Violation[];
}
