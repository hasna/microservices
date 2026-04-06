/**
 * Session annotations — bookmarks and notes on messages or message ranges within a session.
 */

import type { Sql } from "postgres";

export type AnnotationType = "bookmark" | "note" | "highlight" | "tag" | "issue";

export interface SessionAnnotation {
  id: string;
  session_id: string;
  message_id: string | null;
  start_message_id: string | null;
  end_message_id: string | null;
  annotation_type: AnnotationType;
  label: string | null;
  note: string | null;
  color: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAnnotationInput {
  sessionId: string;
  messageId?: string;
  startMessageId?: string;
  endMessageId?: string;
  annotationType: AnnotationType;
  label?: string;
  note?: string;
  color?: string;
  createdBy?: string;
}

/**
 * Create an annotation on a session, message, or range.
 */
export async function createAnnotation(
  sql: Sql,
  input: CreateAnnotationInput,
): Promise<SessionAnnotation> {
  const [ann] = await sql<SessionAnnotation[]>`
    INSERT INTO sessions.session_annotations (
      session_id, message_id, start_message_id, end_message_id,
      annotation_type, label, note, color, created_by
    )
    VALUES (
      ${input.sessionId},
      ${input.messageId ?? null},
      ${input.startMessageId ?? null},
      ${input.endMessageId ?? null},
      ${input.annotationType},
      ${input.label ?? null},
      ${input.note ?? null},
      ${input.color ?? null},
      ${input.createdBy ?? null}
    )
    RETURNING *
  `;
  return ann;
}

/**
 * Get an annotation by ID.
 */
export async function getAnnotation(
  sql: Sql,
  annotationId: string,
): Promise<SessionAnnotation | null> {
  const [ann] = await sql<SessionAnnotation[]>`
    SELECT * FROM sessions.session_annotations WHERE id = ${annotationId}
  `;
  return ann ?? null;
}

/**
 * List annotations for a session.
 */
export async function listSessionAnnotations(
  sql: Sql,
  sessionId: string,
  type?: AnnotationType,
): Promise<SessionAnnotation[]> {
  if (type) {
    return sql<SessionAnnotation[]>`
      SELECT * FROM sessions.session_annotations
      WHERE session_id = ${sessionId} AND annotation_type = ${type}
      ORDER BY created_at ASC
    `;
  }
  return sql<SessionAnnotation[]>`
    SELECT * FROM sessions.session_annotations
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
  `;
}

/**
 * Update an annotation's label, note, or color.
 */
export async function updateAnnotation(
  sql: Sql,
  annotationId: string,
  updates: {
    label?: string;
    note?: string;
    color?: string;
  },
): Promise<SessionAnnotation | null> {
  const setClauses: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  if (updates.label !== undefined) {
    setClauses.push(`label = $${idx++}`);
    vals.push(updates.label);
  }
  if (updates.note !== undefined) {
    setClauses.push(`note = $${idx++}`);
    vals.push(updates.note);
  }
  if (updates.color !== undefined) {
    setClauses.push(`color = $${idx++}`);
    vals.push(updates.color);
  }
  setClauses.push(`updated_at = NOW()`);

  if (setClauses.length === 1) return getAnnotation(sql, annotationId);

  vals.push(annotationId);
  const [ann] = await sql.unsafe(
    `UPDATE sessions.session_annotations SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
    vals,
  ) as SessionAnnotation[];
  return ann ?? null;
}

/**
 * Delete an annotation.
 */
export async function deleteAnnotation(
  sql: Sql,
  annotationId: string,
): Promise<boolean> {
  const result = await sql.unsafe(
    `DELETE FROM sessions.session_annotations WHERE id = $1`,
    [annotationId],
  );
  return (result.count ?? 0) > 0;
}

/**
 * Delete all annotations for a session.
 */
export async function deleteAllSessionAnnotations(
  sql: Sql,
  sessionId: string,
): Promise<number> {
  const result = await sql.unsafe(
    `DELETE FROM sessions.session_annotations WHERE session_id = $1`,
    [sessionId],
  );
  return result.count ?? 0;
}

/**
 * Get annotations for a specific message.
 */
export async function getMessageAnnotations(
  sql: Sql,
  messageId: string,
): Promise<SessionAnnotation[]> {
  return sql<SessionAnnotation[]>`
    SELECT * FROM sessions.session_annotations
    WHERE message_id = ${messageId}
       OR (start_message_id <= ${messageId} AND end_message_id >= ${messageId})
    ORDER BY created_at ASC
  `;
}

/**
 * Get annotation count by type for a session.
 */
export async function getAnnotationStats(
  sql: Sql,
  sessionId: string,
): Promise<Record<AnnotationType, number>> {
  const rows = await sql<{ annotation_type: AnnotationType; count: number }[]>`
    SELECT annotation_type, COUNT(*) as count
    FROM sessions.session_annotations
    WHERE session_id = ${sessionId}
    GROUP BY annotation_type
  `;
  const stats: Record<string, number> = { bookmark: 0, note: 0, highlight: 0, tag: 0, issue: 0 };
  for (const r of rows) stats[r.annotation_type] = Number(r.count);
  return stats as Record<AnnotationType, number>;
}
