import type { Sql } from "postgres";

export interface RateLimitConfig {
  requests_per_minute: number;
  tokens_per_minute: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  current_requests: number;
  limit_requests: number;
  reset_at: Date;
  retry_after_ms?: number;
}

/**
 * Check if a workspace+provider request is within rate limits.
 * Uses an in-memory sliding window counter keyed by workspace_id:provider.
 * Also reads/writes to llm.rate_limits table for persistence.
 */
export async function checkRateLimit(
  sql: Sql,
  workspaceId: string,
  provider: string,
  estimatedTokens?: number,
): Promise<RateLimitStatus> {
  // Get configured limits from DB
  const [limitRow] = await sql<[{ requests_per_minute: number; tokens_per_minute: number } | undefined]>`
    SELECT requests_per_minute, tokens_per_minute FROM llm.rate_limits
    WHERE workspace_id = ${workspaceId} AND provider = ${provider}
  `;
  const rpm = limitRow?.requests_per_minute ?? 60;
  const tpm = limitRow?.tokens_per_minute ?? 100_000;

  // Check in-memory sliding window
  const key = `${workspaceId}:${provider}`;
  const now = Date.now();
  const windowMs = 60_000;
  const windowStart = now - windowMs;

  // Clean old entries and count recent
  const recent = recentRequests.get(key)?.filter((t) => t > windowStart) ?? [];
  const currentRequests = recent.length;

  if (currentRequests >= rpm) {
    const oldestInWindow = Math.min(...recent);
    const retryAfterMs = oldestInWindow + windowMs - now;
    return {
      allowed: false,
      current_requests: currentRequests,
      limit_requests: rpm,
      reset_at: new Date(now + retryAfterMs),
      retry_after_ms: retryAfterMs,
    };
  }

  if (estimatedTokens) {
    const tokenKey = `${key}:tokens`;
    const recentTokens =
      recentTokenRequests.get(tokenKey)?.filter((t) => t > windowStart) ?? [];
    const currentTokens = recentTokens.reduce((a, b) => a + b, 0);
    if (currentTokens + estimatedTokens > tpm) {
      const oldest = Math.min(...(recentTokenRequests.get(tokenKey) ?? [now]));
      const retryAfterMs = oldest + windowMs - now;
      return {
        allowed: false,
        current_requests: currentRequests,
        limit_requests: rpm,
        reset_at: new Date(now + retryAfterMs),
        retry_after_ms: retryAfterMs,
      };
    }
    recentTokenRequests.set(tokenKey, [...recentTokens, estimatedTokens]);
  }

  recentRequests.set(key, [...recent, now]);
  return {
    allowed: true,
    current_requests: currentRequests + 1,
    limit_requests: rpm,
    reset_at: new Date(now + windowMs),
  };
}

// In-memory sliding windows (module-level state)
const recentRequests = new Map<string, number[]>();
const recentTokenRequests = new Map<string, number[]>();

/**
 * Set rate limit config for a workspace+provider.
 */
export async function setRateLimit(
  sql: Sql,
  workspaceId: string,
  provider: string,
  config: RateLimitConfig,
): Promise<void> {
  await sql`
    INSERT INTO llm.rate_limits (workspace_id, provider, requests_per_minute, tokens_per_minute)
    VALUES (${workspaceId}, ${provider}, ${config.requests_per_minute}, ${config.tokens_per_minute})
    ON CONFLICT (workspace_id, provider) DO UPDATE SET
      requests_per_minute = EXCLUDED.requests_per_minute,
      tokens_per_minute = EXCLUDED.tokens_per_minute
  `;
}
