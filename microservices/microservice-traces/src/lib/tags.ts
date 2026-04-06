/**
 * Span tagging and annotation utilities.
 */

import type { Sql } from "postgres";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpanTag {
  id: number;
  span_id: string;
  key: string;
  value: string;
  created_at: Date;
}

export interface SpanAnnotation {
  id: number;
  span_id: string;
  text: string;
  timestamp: Date;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// add_span_tag
// ---------------------------------------------------------------------------

export async function add_span_tag(
  sql: Sql,
  spanId: string,
  key: string,
  value: string,
): Promise<SpanTag> {
  const [tag] = await sql<SpanTag[]>`
    INSERT INTO traces.span_tags (span_id, key, value)
    VALUES (${spanId}, ${key}, ${value})
    RETURNING *
  `;
  return tag;
}

// ---------------------------------------------------------------------------
// get_span_tags
// ---------------------------------------------------------------------------

export async function get_span_tags(
  sql: Sql,
  spanId: string,
): Promise<SpanTag[]> {
  return sql<SpanTag[]>`
    SELECT * FROM traces.span_tags
    WHERE span_id = ${spanId}
    ORDER BY created_at ASC
  `;
}

// ---------------------------------------------------------------------------
// delete_span_tag
// ---------------------------------------------------------------------------

export async function delete_span_tag(
  sql: Sql,
  spanId: string,
  key: string,
): Promise<boolean> {
  const [result] = await sql<[{ id: number }?]>`
    DELETE FROM traces.span_tags
    WHERE span_id = ${spanId} AND key = ${key}
    RETURNING id
  `;
  return result !== undefined;
}

// ---------------------------------------------------------------------------
// add_span_annotation
// ---------------------------------------------------------------------------

export async function add_span_annotation(
  sql: Sql,
  spanId: string,
  annotationText: string,
  timestamp?: Date,
): Promise<SpanAnnotation> {
  const ts = timestamp ?? new Date();
  const [annotation] = await sql<SpanAnnotation[]>`
    INSERT INTO traces.span_annotations (span_id, text, timestamp)
    VALUES (${spanId}, ${annotationText}, ${ts})
    RETURNING *
  `;
  return annotation;
}

// ---------------------------------------------------------------------------
// get_span_annotations
// ---------------------------------------------------------------------------

export async function get_span_annotations(
  sql: Sql,
  spanId: string,
): Promise<SpanAnnotation[]> {
  return sql<SpanAnnotation[]>`
    SELECT * FROM traces.span_annotations
    WHERE span_id = ${spanId}
    ORDER BY timestamp ASC
  `;
}
