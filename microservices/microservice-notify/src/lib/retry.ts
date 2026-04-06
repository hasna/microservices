import type { Sql } from "postgres";

/**
 * Exponential backoff retry scheduling for failed notification deliveries.
 * Replaces simple retry_count++ with proper backoff: delay = baseDelay * 2^attempt
 * with jitter to avoid thundering herd.
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  /** Factors beyond exponential (e.g., channel-specific multipliers) */
  channelMultiplier?: number;
}

/** Default retry configs per channel type */
export const DEFAULT_RETRY_CONFIGS: Record<string, RetryConfig> = {
  email: { maxRetries: 5, baseDelaySeconds: 30, maxDelaySeconds: 3600 },
  sms:   { maxRetries: 3, baseDelaySeconds: 15, maxDelaySeconds: 300 },
  in_app:{ maxRetries: 2, baseDelaySeconds: 5,  maxDelaySeconds: 60 },
  webhook:{ maxRetries: 4, baseDelaySeconds: 10, maxDelaySeconds: 600 },
};

export interface RetryRecord {
  id: string;
  notification_id: string;
  channel: string;
  attempt: number;
  next_retry_at: string;
  last_error: string | null;
  created_at: string;
}

/**
 * Calculate the next retry time using exponential backoff with jitter.
 * delay = min(maxDelay, baseDelay * 2^attempt) ± random_jitter(10%)
 */
export function calculateBackoff(
  attempt: number,
  config: RetryConfig,
): Date {
  const exponentialDelay = config.baseDelaySeconds * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelaySeconds);
  const jitter = cappedDelay * 0.1 * (Math.random() * 2 - 1); // ±10%
  const totalDelay = Math.max(1, Math.round(cappedDelay + jitter));
  const next = new Date(Date.now() + totalDelay * 1000);
  return next;
}

/**
 * Record a failed delivery attempt and schedule the next retry.
 * Returns the RetryRecord, or null if max retries exceeded.
 */
export async function recordRetry(
  sql: Sql,
  notificationId: string,
  channel: string,
  error: string,
  attempt: number,
  config?: RetryConfig,
): Promise<RetryRecord | null> {
  const cfg = config ?? DEFAULT_RETRY_CONFIGS[channel] ?? { maxRetries: 3, baseDelaySeconds: 30, maxDelaySeconds: 600 };

  if (attempt >= cfg.maxRetries) {
    // Mark notification as permanently failed
    await sql`
      UPDATE notify.notifications
      SET status = 'failed'
      WHERE id = ${notificationId}
    `;
    return null;
  }

  const nextRetryAt = calculateBackoff(attempt, cfg);

  const [record] = await sql<RetryRecord[]>`
    INSERT INTO notify.retry_log (notification_id, channel, attempt, next_retry_at, last_error)
    VALUES (${notificationId}, ${channel}, ${attempt}, ${nextRetryAt}, ${error})
    RETURNING *
  `;

  // Update delivery_record with next_retry_at
  await sql`
    UPDATE notify.delivery_records
    SET retry_count = ${attempt + 1},
        next_retry_at = ${nextRetryAt},
        status = 'pending'
    WHERE notification_id = ${notificationId}
      AND channel = ${channel}
  `;

  return record;
}

/**
 * Get the next retry record that is due (next_retry_at <= now).
 */
export async function getDueRetries(
  sql: Sql,
  limit = 50,
): Promise<RetryRecord[]> {
  return sql<RetryRecord[]>`
    SELECT * FROM notify.retry_log
    WHERE next_retry_at <= NOW()
    ORDER BY next_retry_at ASC
    LIMIT ${limit}
  `;
}

/**
 * Get retry history for a notification.
 */
export async function getRetryHistory(
  sql: Sql,
  notificationId: string,
): Promise<RetryRecord[]> {
  return sql<RetryRecord[]>`
    SELECT * FROM notify.retry_log
    WHERE notification_id = ${notificationId}
    ORDER BY attempt ASC
  `;
}

/**
 * Cancel pending retries for a notification (e.g., if it was cancelled).
 */
export async function cancelRetries(
  sql: Sql,
  notificationId: string,
): Promise<number> {
  const r = await sql`
    DELETE FROM notify.retry_log
    WHERE notification_id = ${notificationId}
      AND next_retry_at > NOW()
    RETURNING id
  `;
  return r.count;
}

/**
 * Clear all retry records (e.g., after a notification is successfully sent).
 */
export async function clearRetries(
  sql: Sql,
  notificationId: string,
): Promise<void> {
  await sql`DELETE FROM notify.retry_log WHERE notification_id = ${notificationId}`;
}

/**
 * Get retry statistics for a workspace or channel.
 */
export async function getRetryStats(
  sql: Sql,
  opts: { workspaceId?: string; channel?: string; since?: Date } = {},
): Promise<{ channel: string; attempts: number; successes: number; failures: number; avg_attempt: number }[]> {
  const workspaceFilter = opts.workspaceId
    ? sql`AND n.workspace_id = ${opts.workspaceId}`
    : sql``;
  const channelFilter = opts.channel
    ? sql`AND r.channel = ${opts.channel}`
    : sql``;
  const sinceFilter = opts.since
    ? sql`AND r.created_at >= ${opts.since}`
    : sql``;

  return sql<Array<{ channel: string; attempts: number; successes: number; failures: number; avg_attempt: number }>>`
    SELECT
      r.channel,
      COUNT(*)::int AS attempts,
      COUNT(*) FILTER (WHERE n.status = 'sent') AS successes,
      COUNT(*) FILTER (WHERE n.status = 'failed') AS failures,
      AVG(r.attempt)::float AS avg_attempt
    FROM notify.retry_log r
    JOIN notify.notifications n ON n.id = r.notification_id
    WHERE true ${workspaceFilter} ${channelFilter} ${sinceFilter}
    GROUP BY r.channel
    ORDER BY r.channel
  `;
}

/**
 * Get retry subsystem health — checks for stuck retries, high failure rates,
 * and returns an overall health score.
 */
export async function getRetrySubsystemHealth(
  sql: Sql,
): Promise<{
  status: "healthy" | "degraded" | "unhealthy";
  score: number; // 0-100
  pendingRetries: number;
  dueRetries: number;
  permanentlyFailed24h: number;
  avgRetryAttempts: number;
  issues: string[];
}> {
  const issues: string[] = [];

  const [pendingRow] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int AS count FROM notify.retry_log
    WHERE next_retry_at > NOW()
  `;
  const pendingRetries = pendingRow.count;

  const [dueRow] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int AS count FROM notify.retry_log
    WHERE next_retry_at <= NOW()
  `;
  const dueRetries = dueRow.count;

  const [failedRow] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int AS count FROM notify.retry_log
    WHERE created_at >= NOW() - INTERVAL '24 hours'
      AND next_retry_at IS NULL
  `;
  const permanentlyFailed24h = failedRow.count;

  const [avgRow] = await sql<[{ avg: number }]>`
    SELECT AVG(attempt)::float AS avg FROM notify.retry_log
    WHERE created_at >= NOW() - INTERVAL '24 hours'
  `;
  const avgRetryAttempts = avgRow?.avg ?? 0;

  // Determine issues
  if (dueRetries > 1000) issues.push(`High number of due retries: ${dueRetries}`);
  if (permanentlyFailed24h > 100) issues.push(`High permanent failure rate: ${permanentlyFailed24h}/24h`);
  if (avgRetryAttempts > 4) issues.push(`High average retry attempts: ${avgRetryAttempts.toFixed(1)}`);

  // Compute score
  let score = 100;
  score -= Math.min(30, dueRetries * 0.01);
  score -= Math.min(30, permanentlyFailed24h * 0.1);
  score -= Math.min(20, Math.max(0, (avgRetryAttempts - 2) * 5));
  score = Math.max(0, Math.round(score));

  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (score < 50) status = "unhealthy";
  else if (score < 80) status = "degraded";

  return { status, score, pendingRetries, dueRetries, permanentlyFailed24h, avgRetryAttempts, issues };
}

/**
 * Drain (retrieve) all permanently failed retries — ones that exceeded max retries.
 * Returns full details including last error for forensics.
 */
export async function drainFailedRetries(
  sql: Sql,
  opts: {
    workspaceId?: string;
    channel?: string;
    since?: Date;
    limit?: number;
  } = {},
): Promise<Array<{
  notification_id: string;
  channel: string;
  final_attempt: number;
  last_error: string | null;
  failed_at: string;
  user_id: string | null;
  workspace_id: string | null;
  title: string | null;
  body: string;
}>> {
  const workspaceFilter = opts.workspaceId
    ? sql`AND n.workspace_id = ${opts.workspaceId}`
    : sql``;
  const channelFilter = opts.channel
    ? sql`AND r.channel = ${opts.channel}`
    : sql``;
  const sinceFilter = opts.since
    ? sql`AND r.created_at >= ${opts.since}`
    : sql``;

  return sql`
    SELECT
      r.notification_id,
      r.channel,
      r.attempt AS final_attempt,
      r.last_error,
      r.next_retry_at AS failed_at,
      n.user_id,
      n.workspace_id,
      n.title,
      n.body
    FROM notify.retry_log r
    JOIN notify.notifications n ON n.id = r.notification_id
    WHERE r.next_retry_at IS NULL
      ${workspaceFilter}
      ${channelFilter}
      ${sinceFilter}
    ORDER BY r.created_at DESC
    LIMIT ${opts.limit ?? 100}
  `;
}
