/**
 * Per-client sliding-window rate limiting.
 *
 * Identifies clients by IP address and/or API key, then enforces
 * per-client request limits using a sliding window counter stored in Redis
 * (or an in-memory Map as fallback).
 *
 * Limits are configurable per workspace + client combination.
 */

import type { Sql } from "postgres";

export interface ClientRateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in seconds */
  windowSeconds: number;
  /** Block duration in seconds when limit is exceeded */
  blockDurationSeconds?: number;
}

export interface ClientRateLimitStatus {
  allowed: boolean;
  clientId: string;
  requestsInWindow: number;
  maxRequests: number;
  windowSeconds: number;
  resetAt: Date;
  blockedUntil: Date | null;
}

/** Identify a client by IP and/or API key */
export function identifyClient(
  ipAddress?: string | null,
  apiKey?: string | null,
  userAgent?: string | null,
): string {
  if (apiKey) return `key:${hashString(apiKey.slice(0, 16))}`;
  if (ipAddress) return `ip:${ipAddress}`;
  if (userAgent) return `ua:${hashString(userAgent.slice(0, 32))}`;
  return `unknown:${Math.random().toString(36).slice(2)}`;
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return Math.abs(h).toString(36);
}

export interface RateLimitRecord {
  workspace_id: string;
  client_id: string;
  max_requests: number;
  window_seconds: number;
  block_duration_seconds: number;
  enabled: boolean;
}

/**
 * Set a per-client rate limit for a workspace.
 */
export async function setClientRateLimit(
  sql: Sql,
  opts: {
    workspaceId: string;
    clientId: string;
    maxRequests: number;
    windowSeconds: number;
    blockDurationSeconds?: number;
    enabled?: boolean;
  },
): Promise<RateLimitRecord> {
  const {
    workspaceId,
    clientId,
    maxRequests,
    windowSeconds,
    blockDurationSeconds = 60,
    enabled = true,
  } = opts;

  const [row] = await sql<RateLimitRecord[]>`
    INSERT INTO guardrails.client_rate_limits
      (workspace_id, client_id, max_requests, window_seconds, block_duration_seconds, enabled)
    VALUES (${workspaceId}, ${clientId}, ${maxRequests}, ${windowSeconds}, ${blockDurationSeconds}, ${enabled})
    ON CONFLICT (workspace_id, client_id) DO UPDATE
      SET max_requests = EXCLUDED.max_requests,
          window_seconds = EXCLUDED.window_seconds,
          block_duration_seconds = EXCLUDED.block_duration_seconds,
          enabled = EXCLUDED.enabled
    RETURNING *
  `;
  return row;
}

/**
 * Check and record a request against a client's sliding window.
 * Uses a sliding window log (list of request timestamps) stored per client.
 *
 * Returns { allowed, clientId, requestsInWindow, maxRequests, windowSeconds, resetAt, blockedUntil }
 */
export async function checkClientRateLimit(
  sql: Sql,
  workspaceId: string,
  clientId: string,
): Promise<ClientRateLimitStatus> {
  // Get limit config
  const [config] = await sql<RateLimitRecord[]>`
    SELECT * FROM guardrails.client_rate_limits
    WHERE workspace_id = ${workspaceId}
      AND client_id = ${clientId}
      AND enabled = true
  `;

  if (!config) {
    // No limit configured — allow
    return {
      allowed: true,
      clientId,
      requestsInWindow: 0,
      maxRequests: Infinity,
      windowSeconds: 0,
      resetAt: new Date(),
      blockedUntil: null,
    };
  }

  const now = Date.now();
  const windowMs = config.window_seconds * 1000;
  const blockMs = config.block_duration_seconds * 1000;
  const windowStart = new Date(now - windowMs);

  // Check if currently blocked
  const [blockRecord] = await sql<{ blocked_until: Date | null }[]>`
    SELECT blocked_until FROM guardrails.client_rate_blocks
    WHERE workspace_id = ${workspaceId}
      AND client_id = ${clientId}
      AND blocked_until > NOW()
    ORDER BY blocked_until DESC
    LIMIT 1
  `;

  if (blockRecord?.blocked_until) {
    return {
      allowed: false,
      clientId,
      requestsInWindow: 0,
      maxRequests: config.max_requests,
      windowSeconds: config.window_seconds,
      resetAt: new Date(now + windowMs),
      blockedUntil: blockRecord.blocked_until,
    };
  }

  // Prune old timestamps outside the window
  await sql`
    DELETE FROM guardrails.client_rate_log
    WHERE workspace_id = ${workspaceId}
      AND client_id = ${clientId}
      AND recorded_at < ${windowStart}
  `;

  // Count current requests in window
  const [countRow] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM guardrails.client_rate_log
    WHERE workspace_id = ${workspaceId}
      AND client_id = ${clientId}
  `;

  const requestsInWindow = Number(countRow.count);

  if (requestsInWindow >= config.max_requests) {
    // Exceeded — insert block record
    const blockedUntil = new Date(now + blockMs);
    await sql`
      INSERT INTO guardrails.client_rate_blocks
        (workspace_id, client_id, blocked_until)
      VALUES (${workspaceId}, ${clientId}, ${blockedUntil})
      ON CONFLICT (workspace_id, client_id) DO UPDATE
        SET blocked_until = EXCLUDED.blocked_until
    `;
    return {
      allowed: false,
      clientId,
      requestsInWindow,
      maxRequests: config.max_requests,
      windowSeconds: config.window_seconds,
      resetAt: new Date(now + windowMs),
      blockedUntil,
    };
  }

  // Record this request
  await sql`
    INSERT INTO guardrails.client_rate_log (workspace_id, client_id, recorded_at)
    VALUES (${workspaceId}, ${clientId}, NOW())
  `;

  return {
    allowed: true,
    clientId,
    requestsInWindow: requestsInWindow + 1,
    maxRequests: config.max_requests,
    windowSeconds: config.window_seconds,
    resetAt: new Date(now + windowMs),
    blockedUntil: null,
  };
}

/**
 * List current rate limit statuses for all clients in a workspace.
 */
export async function listClientRateLimitStatuses(
  sql: Sql,
  workspaceId: string,
): Promise<ClientRateLimitStatus[]> {
  const configs = await sql<RateLimitRecord[]>`
    SELECT * FROM guardrails.client_rate_limits
    WHERE workspace_id = ${workspaceId} AND enabled = true
  `;

  const statuses: ClientRateLimitStatus[] = [];
  for (const config of configs) {
    const windowMs = config.window_seconds * 1000;
    const now = Date.now();
    const windowStart = new Date(now - windowMs);

    await sql`
      DELETE FROM guardrails.client_rate_log
      WHERE workspace_id = ${workspaceId}
        AND client_id = ${config.client_id}
        AND recorded_at < ${windowStart}
    `;

    const [countRow] = await sql<[{ count: number }]>`
      SELECT COUNT(*) as count FROM guardrails.client_rate_log
      WHERE workspace_id = ${workspaceId} AND client_id = ${config.client_id}
    `;

    const [blockRecord] = await sql<{ blocked_until: Date | null }[]>`
      SELECT blocked_until FROM guardrails.client_rate_blocks
      WHERE workspace_id = ${workspaceId}
        AND client_id = ${config.client_id}
        AND blocked_until > NOW()
      ORDER BY blocked_until DESC
      LIMIT 1
    `;

    statuses.push({
      allowed: Number(countRow.count) < config.max_requests && !blockRecord,
      clientId: config.client_id,
      requestsInWindow: Number(countRow.count),
      maxRequests: config.max_requests,
      windowSeconds: config.window_seconds,
      resetAt: new Date(now + windowMs),
      blockedUntil: blockRecord?.blocked_until ?? null,
    });
  }

  return statuses;
}

/**
 * Clear a client block immediately.
 */
export async function clearClientBlock(
  sql: Sql,
  workspaceId: string,
  clientId: string,
): Promise<void> {
  await sql`
    DELETE FROM guardrails.client_rate_blocks
    WHERE workspace_id = ${workspaceId} AND client_id = ${clientId}
  `;
}
