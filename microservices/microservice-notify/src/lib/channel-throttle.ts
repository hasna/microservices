/**
 * Channel throttle/burst rate limiting — enforce per-channel rate limits
 * with burst capacity for notify microservice.
 */

import type { Sql } from "postgres";

export interface ThrottleConfig {
  workspace_id: string;
  channel: string;
  rate_per_minute: number;
  burst_limit: number;
  window_seconds: number;
}

export interface ThrottleStatus {
  allowed: boolean;
  current_count: number;
  limit: number;
  remaining: number;
  reset_at: string;
  retry_after_seconds: number | null;
}

export interface ThrottleBurstState {
  tokens: number;
  max_tokens: number;
  last_refill_at: string;
}

/**
 * Set throttle configuration for a workspace + channel combination.
 */
export async function setChannelThrottle(
  sql: Sql,
  workspaceId: string,
  channel: string,
  ratePerMinute: number,
  burstLimit: number,
  windowSeconds = 60,
): Promise<ThrottleConfig> {
  const [config] = await sql<ThrottleConfig[]>`
    INSERT INTO notify.channel_throttles (workspace_id, channel, rate_per_minute, burst_limit, window_seconds)
    VALUES (${workspaceId}, ${channel}, ${ratePerMinute}, ${burstLimit}, ${windowSeconds})
    ON CONFLICT (workspace_id, channel) DO UPDATE
      SET rate_per_minute = EXCLUDED.rate_per_minute,
          burst_limit = EXCLUDED.burst_limit,
          window_seconds = EXCLUDED.window_seconds
    RETURNING *
  `;
  return config;
}

/**
 * Get throttle configuration for a workspace + channel.
 */
export async function getChannelThrottle(
  sql: Sql,
  workspaceId: string,
  channel: string,
): Promise<ThrottleConfig | null> {
  const [config] = await sql<ThrottleConfig[]>`
    SELECT * FROM notify.channel_throttles
    WHERE workspace_id = ${workspaceId} AND channel = ${channel}
  `;
  return config ?? null;
}

/**
 * Check if a notification is allowed under throttle limits.
 * Uses token bucket algorithm for burst handling.
 */
export async function checkThrottle(
  sql: Sql,
  workspaceId: string,
  channel: string,
  cost = 1,
): Promise<ThrottleStatus> {
  const config = await getChannelThrottle(sql, workspaceId, channel);

  if (!config) {
    // No throttle configured — allow all
    return {
      allowed: true,
      current_count: 0,
      limit: -1,
      remaining: -1,
      reset_at: new Date().toISOString(),
      retry_after_seconds: null,
    };
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - config.window_seconds * 1000);

  // Count recent notifications in window
  const [countResult] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int as count
    FROM notify.notification_throttle_log
    WHERE workspace_id = ${workspaceId}
      AND channel = ${channel}
      AND created_at >= ${windowStart.toISOString()}
  `;

  const currentCount = countResult.count;
  const remaining = Math.max(0, config.burst_limit - currentCount);
  const resetAt = new Date(now.getTime() + config.window_seconds * 1000);

  if (currentCount >= config.burst_limit) {
    // Over burst limit
    const retryAfter = Math.ceil((resetAt.getTime() - now.getTime()) / 1000);
    return {
      allowed: false,
      current_count: currentCount,
      limit: config.burst_limit,
      remaining: 0,
      reset_at: resetAt.toISOString(),
      retry_after_seconds: retryAfter,
    };
  }

  // Log this notification attempt
  await sql`
    INSERT INTO notify.notification_throttle_log (workspace_id, channel, cost)
    VALUES (${workspaceId}, ${channel}, ${cost})
  `;

  return {
    allowed: true,
    current_count: currentCount + cost,
    limit: config.burst_limit,
    remaining: remaining - cost,
    reset_at: resetAt.toISOString(),
    retry_after_seconds: null,
  };
}

/**
 * Get throttle status without consuming a token.
 */
export async function getThrottleStatus(
  sql: Sql,
  workspaceId: string,
  channel: string,
): Promise<ThrottleStatus> {
  const config = await getChannelThrottle(sql, workspaceId, channel);

  if (!config) {
    return {
      allowed: true,
      current_count: 0,
      limit: -1,
      remaining: -1,
      reset_at: new Date().toISOString(),
      retry_after_seconds: null,
    };
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - config.window_seconds * 1000);

  const [countResult] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int as count
    FROM notify.notification_throttle_log
    WHERE workspace_id = ${workspaceId}
      AND channel = ${channel}
      AND created_at >= ${windowStart.toISOString()}
  `;

  const currentCount = countResult.count;
  const remaining = Math.max(0, config.burst_limit - currentCount);
  const resetAt = new Date(now.getTime() + config.window_seconds * 1000);

  return {
    allowed: currentCount < config.burst_limit,
    current_count: currentCount,
    limit: config.burst_limit,
    remaining,
    reset_at: resetAt.toISOString(),
    retry_after_seconds: currentCount >= config.burst_limit
      ? Math.ceil((resetAt.getTime() - now.getTime()) / 1000)
      : null,
  };
}

/**
 * List all throttle configurations for a workspace.
 */
export async function listWorkspaceThrottles(
  sql: Sql,
  workspaceId: string,
): Promise<ThrottleConfig[]> {
  return sql<ThrottleConfig[]>`
    SELECT * FROM notify.channel_throttles
    WHERE workspace_id = ${workspaceId}
    ORDER BY channel
  `;
}

/**
 * Delete a throttle configuration.
 */
export async function deleteChannelThrottle(
  sql: Sql,
  workspaceId: string,
  channel: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM notify.channel_throttles
    WHERE workspace_id = ${workspaceId} AND channel = ${channel}
  `;
  return result.count > 0;
}