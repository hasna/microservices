/**
 * Session importance scoring — computes an importance score (0–100) per
 * conversation based on activity patterns, annotations, fork relationships,
 * and metadata signals.
 *
 * Higher score = more important = less likely to be auto-archived or deleted.
 * Scores are recalculated on activity and used by retention policies to
 * protect high-value sessions.
 */

import type { Sql } from "postgres";
import type { Conversation } from "./conversations.js";

export interface SessionImportance {
  session_id: string;
  importance_score: number;
  activity_score: number;
  annotation_score: number;
  fork_score: number;
  metadata_score: number;
  is_pinned_override: boolean | null;
  computed_at: string;
  updated_at: string;
}

interface ImportanceFactors {
  messageCount: number;
  lastActivityHours: number;
  annotationCount: number;
  bookmarkCount: number;
  forkCount: number;
  isPinned: boolean;
  isArchived: boolean;
  isForkPinned: boolean;
  hasRootSession: boolean;
  tokenCount: number;
  daysOld: number;
}

const WEIGHTS = {
  messageCount: 0.20,      // more messages = more important
  recency: 0.20,           // recent activity = more important
  annotation: 0.25,        // annotations = high signal of importance
  fork: 0.15,              // forks = branching importance
  pinned: 0.10,            // explicit pin = user-valued
  tokenCount: 0.05,        // more tokens = deeper conversation
  age: 0.05,               // newer sessions slightly more important
} as const;

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function computeImportance(factors: ImportanceFactors): {
  total: number;
  activity: number;
  annotation: number;
  fork: number;
  metadata: number;
} {
  // Activity score: message count + recency
  const messageScore = normalize(factors.messageCount, 0, 100) * 50;
  const recencyScore = Math.max(0, 50 - factors.lastActivityHours * 2);
  const activity = Math.min(100, messageScore + recencyScore);

  // Annotation score: annotations + bookmarks
  const annotationScore = normalize(factors.annotationCount, 0, 20) * 60;
  const bookmarkScore = normalize(factors.bookmarkCount, 0, 10) * 40;
  const annotation = Math.min(100, annotationScore + bookmarkScore);

  // Fork score: fork count + fork pinning + has root (part of a lineage)
  let fork = 0;
  if (factors.isForkPinned) fork += 40;
  if (factors.hasRootSession) fork += 30;
  fork += Math.min(30, factors.forkCount * 10);
  fork = Math.min(100, fork);

  // Metadata score: pinned session + not archived
  let metadata = 0;
  if (factors.isPinned) metadata += 60;
  if (!factors.isArchived) metadata += 40;
  // Token bonus (proxy for depth)
  metadata += Math.min(20, normalize(factors.tokenCount, 0, 50000) * 20);
  metadata = Math.min(100, metadata);

  // Weighted total
  const total = Math.round(
    activity * WEIGHTS.messageCount +
    Math.max(0, 100 - factors.lastActivityHours * 2) * WEIGHTS.recency +
    annotation * WEIGHTS.annotation +
    fork * WEIGHTS.fork +
    metadata * WEIGHTS.pinned +
    normalize(factors.tokenCount, 0, 50000) * WEIGHTS.tokenCount * 100 +
    Math.max(0, 100 - factors.daysOld * 2) * WEIGHTS.age,
  );

  return {
    total: Math.min(100, Math.max(0, Math.round(total))),
    activity: Math.round(activity),
    annotation: Math.round(annotation),
    fork: Math.round(fork),
    metadata: Math.round(metadata),
  };
}

/**
 * Get the importance score for a session.
 */
export async function getSessionImportance(
  sql: Sql,
  sessionId: string,
): Promise<SessionImportance | null> {
  const [row] = await sql<SessionImportance[]>`
    SELECT * FROM sessions.session_importance WHERE session_id = ${sessionId}
  `;
  return row ?? null;
}

/**
 * Compute and upsert the importance score for a session.
 */
export async function computeAndStoreSessionImportance(
  sql: Sql,
  sessionId: string,
  opts: {
    messageCount?: number;
    lastActivityHours?: number;
    annotationCount?: number;
    bookmarkCount?: number;
    forkCount?: number;
    isPinned?: boolean;
    isArchived?: boolean;
    isForkPinned?: boolean;
    hasRootSession?: boolean;
    tokenCount?: number;
    daysOld?: number;
    isPinnedOverride?: boolean;
  } = {},
): Promise<SessionImportance> {
  // Fetch defaults from DB if not provided
  const [conv] = await sql<Conversation[]>`
    SELECT c.*, m.message_count, m.total_tokens
    FROM sessions.conversations c
    LEFT JOIN sessions.session_metrics m ON m.session_id = c.id
    WHERE c.id = ${sessionId}
  `;

  if (!conv) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const [annotationCount] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM sessions.session_annotations WHERE session_id = ${sessionId}
  `;
  const [bookmarkCount] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM sessions.session_bookmarks WHERE session_id = ${sessionId}
  `;
  const [forkCount] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM sessions.conversations
    WHERE parent_session_id = ${sessionId} OR parent_id = ${sessionId}
  `;

  const now = new Date();
  const lastActivity = conv.last_activity_at ? new Date(conv.last_activity_at) : now;
  const createdAt = new Date(conv.created_at);
  const lastActivityHours = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);
  const daysOld = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

  const factors = {
    messageCount: opts.messageCount ?? (conv as any).message_count ?? conv.message_count ?? 0,
    lastActivityHours: opts.lastActivityHours ?? lastActivityHours,
    annotationCount: opts.annotationCount ?? annotationCount?.count ?? 0,
    bookmarkCount: opts.bookmarkCount ?? bookmarkCount?.count ?? 0,
    forkCount: opts.forkCount ?? forkCount?.count ?? 0,
    isPinned: opts.isPinned ?? conv.is_pinned,
    isArchived: opts.isArchived ?? conv.is_archived,
    isForkPinned: opts.isForkPinned ?? conv.is_fork_pinned,
    hasRootSession: opts.hasRootSession ?? (conv.root_id !== null && conv.root_id !== conv.id),
    tokenCount: opts.tokenCount ?? (conv as any).total_tokens ?? 0,
    daysOld: opts.daysOld ?? daysOld,
  };

  const { total, activity, annotation, fork, metadata } = computeImportance(factors);

  const [row] = await sql<SessionImportance[]>`
    INSERT INTO sessions.session_importance (
      session_id, importance_score, activity_score, annotation_score,
      fork_score, metadata_score, is_pinned_override, computed_at, updated_at
    )
    VALUES (
      ${sessionId}, ${total}, ${activity}, ${annotation},
      ${fork}, ${metadata}, ${opts.isPinnedOverride ?? null},
      NOW(), NOW()
    )
    ON CONFLICT (session_id) DO UPDATE SET
      importance_score = EXCLUDED.importance_score,
      activity_score = EXCLUDED.activity_score,
      annotation_score = EXCLUDED.annotation_score,
      fork_score = EXCLUDED.fork_score,
      metadata_score = EXCLUDED.metadata_score,
      is_pinned_override = EXCLUDED.is_pinned_override,
      computed_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `;
  return row;
}

/**
 * List sessions sorted by importance score (highest first).
 */
export async function listSessionsByImportance(
  sql: Sql,
  workspaceId: string,
  opts: {
    minScore?: number;
    limit?: number;
    offset?: number;
  } = {},
): Promise<SessionImportance[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  return sql<SessionImportance[]>`
    SELECT si.* FROM sessions.session_importance si
    JOIN sessions.conversations c ON c.id = si.session_id
    WHERE c.workspace_id = ${workspaceId}
      AND ${opts.minScore !== undefined ? sql`si.importance_score >= ${opts.minScore}` : sql`TRUE`}
    ORDER BY si.importance_score DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * Get sessions at risk of being auto-archived (low importance, old, no pins/forks).
 */
export async function listSessionsAtRisk(
  sql: Sql,
  workspaceId: string,
  opts: {
    maxScore?: number;
    minAgeDays?: number;
    limit?: number;
  } = {},
): Promise<SessionImportance[]> {
  const limit = opts.limit ?? 50;

  return sql<SessionImportance[]>`
    SELECT si.* FROM sessions.session_importance si
    JOIN sessions.conversations c ON c.id = si.session_id
    WHERE c.workspace_id = ${workspaceId}
      AND c.is_archived = FALSE
      AND c.is_pinned = FALSE
      AND c.is_fork_pinned = FALSE
      AND (c.root_id IS NULL OR c.root_id = c.id)
      AND ${opts.maxScore !== undefined ? sql`si.importance_score <= ${opts.maxScore}` : sql`si.importance_score <= 30`}
      AND ${opts.minAgeDays !== undefined
        ? sql`c.created_at < NOW() - INTERVAL '${sql.unsafe(String(opts.minAgeDays))} days'`
        : sql`c.created_at < NOW() - INTERVAL '30 days'`}
    ORDER BY si.importance_score ASC
    LIMIT ${limit}
  `;
}

/**
 * Recompute importance scores for all sessions in a workspace (batch job).
 */
export async function recomputeAllSessionImportance(
  sql: Sql,
  workspaceId: string,
): Promise<number> {
  const sessions = await sql<{ id: string }[]>`
    SELECT id FROM sessions.conversations WHERE workspace_id = ${workspaceId}
  `;

  let count = 0;
  for (const { id } of sessions) {
    await computeAndStoreSessionImportance(sql, id);
    count++;
  }
  return count;
}
