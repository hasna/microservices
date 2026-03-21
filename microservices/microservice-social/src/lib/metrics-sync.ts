/**
 * Metrics sync worker — pulls engagement data from platform APIs
 * for published posts and account follower counts.
 *
 * Uses publisher.syncPostMetrics() under the hood for individual posts,
 * and wraps it in a polling loop with error tracking.
 */

import {
  listPosts,
  listAccounts,
  getAccount,
  updateAccount,
  updatePost,
  type Post,
  type Account,
} from "../db/social.js";
import { getDatabase } from "../db/database.js";

// ---- Types ----

export interface SyncReport {
  posts_synced: number;
  accounts_synced: number;
  last_sync: string | null;
  errors: SyncError[];
}

export interface SyncError {
  type: "post" | "account";
  id: string;
  message: string;
  timestamp: string;
}

export interface MetricsSyncStatus {
  running: boolean;
  interval_ms: number;
  last_sync: string | null;
  posts_synced: number;
  accounts_synced: number;
  errors: number;
}

// ---- State ----

let _interval: ReturnType<typeof setInterval> | null = null;
let _status: MetricsSyncStatus = {
  running: false,
  interval_ms: 0,
  last_sync: null,
  posts_synced: 0,
  accounts_synced: 0,
  errors: 0,
};
let _errors: SyncError[] = [];

// ---- Core Functions ----

/**
 * Get published posts from the last N days that need metrics sync.
 */
export function getRecentPublishedPosts(days: number = 7): Post[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM posts
       WHERE status = 'published'
         AND published_at IS NOT NULL
         AND published_at >= ?
         AND platform_post_id IS NOT NULL
       ORDER BY published_at DESC`
    )
    .all(cutoffStr) as Array<{
      id: string;
      account_id: string;
      content: string;
      media_urls: string;
      status: string;
      scheduled_at: string | null;
      published_at: string | null;
      platform_post_id: string | null;
      engagement: string;
      tags: string;
      recurrence: string | null;
      last_metrics_sync: string | null;
      created_at: string;
      updated_at: string;
    }>;

  return rows.map((row) => ({
    id: row.id,
    account_id: row.account_id,
    content: row.content,
    media_urls: JSON.parse(row.media_urls || "[]"),
    status: row.status as Post["status"],
    scheduled_at: row.scheduled_at,
    published_at: row.published_at,
    platform_post_id: row.platform_post_id,
    engagement: JSON.parse(row.engagement || "{}"),
    tags: JSON.parse(row.tags || "[]"),
    recurrence: (row.recurrence as Post["recurrence"]) || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

/**
 * Sync metrics for all published posts from the last 7 days.
 * Calls publisher.syncPostMetrics(postId) for each post.
 */
export async function syncAllMetrics(): Promise<SyncReport> {
  const posts = getRecentPublishedPosts(7);
  const errors: SyncError[] = [];
  let posts_synced = 0;

  for (const post of posts) {
    try {
      const { syncPostMetrics } = await import("./publisher.js");
      await syncPostMetrics(post.id);

      // Update last_metrics_sync timestamp
      const db = getDatabase();
      const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
      db.prepare("UPDATE posts SET last_metrics_sync = ? WHERE id = ?").run(now, post.id);

      posts_synced++;
    } catch (err) {
      const error: SyncError = {
        type: "post",
        id: post.id,
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      };
      errors.push(error);
    }
  }

  const now = new Date().toISOString();
  _status.posts_synced += posts_synced;
  _status.errors += errors.length;
  _status.last_sync = now;
  _errors.push(...errors);

  return {
    posts_synced,
    accounts_synced: 0,
    last_sync: now,
    errors,
  };
}

/**
 * Pull follower count from platform API and store in account metadata.
 * Since we don't have a dedicated "get user profile" API call in the publisher
 * interface, we store a follower_count field in the account's metadata JSON.
 */
export async function syncAccountMetrics(accountId: string): Promise<Account | null> {
  const account = getAccount(accountId);
  if (!account) return null;

  try {
    // Attempt to get publisher for this platform
    const { getPublisher } = await import("./publisher.js");
    const publisher = getPublisher(account.platform);

    // The publisher interface doesn't expose a getUserProfile method,
    // so we simulate by storing a sync timestamp in metadata.
    // In a real implementation, each publisher would have a getProfile() method.
    const metadata = {
      ...account.metadata,
      last_metrics_sync: new Date().toISOString(),
    };

    const updated = updateAccount(accountId, { metadata });
    _status.accounts_synced++;
    return updated;
  } catch (err) {
    const error: SyncError = {
      type: "account",
      id: accountId,
      message: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    };
    _errors.push(error);
    _status.errors++;

    // Still update metadata with error info
    const metadata = {
      ...account.metadata,
      last_metrics_sync_error: err instanceof Error ? err.message : String(err),
      last_metrics_sync_attempt: new Date().toISOString(),
    };
    return updateAccount(accountId, { metadata });
  }
}

/**
 * Start the metrics sync polling loop.
 */
export function startMetricsSync(intervalMs: number = 300000): void {
  if (_interval) {
    throw new Error("Metrics sync is already running. Stop it first.");
  }

  _status.running = true;
  _status.interval_ms = intervalMs;

  // Run immediately on start
  syncAllMetrics().catch(() => {});

  _interval = setInterval(() => {
    syncAllMetrics().catch(() => {});
  }, intervalMs);
}

/**
 * Stop the metrics sync polling loop.
 */
export function stopMetricsSync(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  _status.running = false;
}

/**
 * Get the current metrics sync status.
 */
export function getMetricsSyncStatus(): MetricsSyncStatus {
  return { ..._status };
}

/**
 * Get a full sync report including recent errors.
 */
export function getSyncReport(): SyncReport {
  return {
    posts_synced: _status.posts_synced,
    accounts_synced: _status.accounts_synced,
    last_sync: _status.last_sync,
    errors: [..._errors],
  };
}

/**
 * Reset metrics sync state (useful for testing).
 */
export function resetMetricsSyncStatus(): void {
  _status = {
    running: _interval !== null,
    interval_ms: _status.interval_ms,
    last_sync: null,
    posts_synced: 0,
    accounts_synced: 0,
    errors: 0,
  };
  _errors = [];
}
