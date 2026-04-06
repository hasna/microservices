/**
 * Replay attack detector — detects duplicate or near-duplicate requests
 * within a configurable time window using stored fingerprints.
 */

import type { Sql } from "postgres";
import { storeFingerprint, findNearDuplicates } from "./fingerprint.js";

export interface ReplayCheckResult {
  isReplay: boolean;
  fingerprintId?: string;
  matchedFingerprint?: string;
  similarity?: number;
  firstSeenAt?: Date;
  windowSeconds: number;
}

export interface ReplayConfig {
  windowSeconds?: number; // default 300 (5 minutes)
  similarityThreshold?: number; // default 0.95 for exact, 0.85 for near-duplicate
  strict?: boolean; // if true, reject near-duplicates too
}

const DEFAULT_WINDOW_SECONDS = 300;
const DEFAULT_SIMILARITY_EXACT = 0.98;
const DEFAULT_SIMILARITY_NEAR = 0.85;

export async function checkReplay(
  sql: Sql,
  opts: {
    workspaceId: string;
    requestHash: string;
    content: string;
    fingerprint?: string;
    config?: ReplayConfig;
  },
): Promise<ReplayCheckResult> {
  const config = opts.config ?? {};
  const windowSeconds = config.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const strict = config.strict ?? false;
  const similarityThreshold = strict
    ? (config.similarityThreshold ?? DEFAULT_SIMILARITY_NEAR)
    : DEFAULT_SIMILARITY_EXACT;

  const windowStart = new Date(Date.now() - windowSeconds * 1000);

  // Check for exact replay (stored fingerprint with same hash)
  const [exact] = await sql`
    SELECT id, fingerprint, created_at
    FROM guardrails.fingerprints
    WHERE workspace_id = ${opts.workspaceId}
      AND text_hash = ${opts.requestHash}
      AND created_at >= ${windowStart}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (exact) {
    return {
      isReplay: true,
      fingerprintId: exact.id,
      matchedFingerprint: exact.fingerprint,
      firstSeenAt: exact.created_at,
      windowSeconds,
    };
  }

  // Check for near-duplicates if strict mode
  if (strict && opts.fingerprint) {
    const nearDuplicates = await findNearDuplicates(
      sql,
      opts.workspaceId,
      opts.fingerprint,
      windowSeconds,
    );

    const matched = nearDuplicates.find(
      (d) => d.similarity >= similarityThreshold,
    );

    if (matched) {
      return {
        isReplay: true,
        fingerprintId: matched.id,
        matchedFingerprint: matched.fingerprint,
        similarity: matched.similarity,
        firstSeenAt: matched.created_at,
        windowSeconds,
      };
    }
  }

  // Not a replay — store fingerprint for future checks
  const fp = opts.fingerprint ?? `replay:${opts.requestHash}`;
  await storeFingerprint(sql, {
    workspaceId: opts.workspaceId,
    textHash: opts.requestHash,
    textSnippet: opts.content.slice(0, 200),
    fingerprint: fp,
  });

  return { isReplay: false, windowSeconds };
}

export async function clearReplayWindow(
  sql: Sql,
  workspaceId: string,
  before?: Date,
): Promise<number> {
  const cutoff = before ?? new Date(Date.now() - DEFAULT_WINDOW_SECONDS * 1000);

  const [result] = await sql`
    WITH deleted AS (
      DELETE FROM guardrails.fingerprints
      WHERE workspace_id = ${workspaceId}
        AND created_at < ${cutoff}
        AND fingerprint LIKE 'replay:%'
      RETURNING id
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `;

  return result.count;
}
