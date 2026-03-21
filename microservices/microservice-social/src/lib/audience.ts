/**
 * Follower sync and audience insights
 */

import { getDatabase } from "../db/database.js";

// ---- Types ----

export interface Follower {
  id: string;
  account_id: string;
  platform_user_id: string | null;
  username: string | null;
  display_name: string | null;
  follower_count: number;
  following: boolean;
  followed_at: string | null;
  unfollowed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface FollowerRow {
  id: string;
  account_id: string;
  platform_user_id: string | null;
  username: string | null;
  display_name: string | null;
  follower_count: number;
  following: number;
  followed_at: string | null;
  unfollowed_at: string | null;
  metadata: string;
  created_at: string;
}

function rowToFollower(row: FollowerRow): Follower {
  return {
    ...row,
    following: row.following === 1,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface AudienceSnapshot {
  id: string;
  account_id: string;
  follower_count: number;
  following_count: number;
  snapshot_at: string;
}

export interface CreateFollowerInput {
  account_id: string;
  platform_user_id?: string;
  username?: string;
  display_name?: string;
  follower_count?: number;
  following?: boolean;
  followed_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ListFollowersFilters {
  following?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateFollowerInput {
  username?: string;
  display_name?: string;
  follower_count?: number;
  following?: boolean;
  unfollowed_at?: string;
  metadata?: Record<string, unknown>;
}

export interface AudienceInsights {
  total_followers: number;
  growth_rate_7d: number;
  growth_rate_30d: number;
  new_followers_7d: number;
  lost_followers_7d: number;
  top_followers: Follower[];
}

export interface GrowthPoint {
  date: string;
  count: number;
}

// ---- Followers CRUD ----

export function createFollower(input: CreateFollowerInput): Follower {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO followers (id, account_id, platform_user_id, username, display_name, follower_count, following, followed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.account_id,
    input.platform_user_id || null,
    input.username || null,
    input.display_name || null,
    input.follower_count ?? 0,
    input.following !== false ? 1 : 0,
    input.followed_at || null,
    metadata
  );

  return getFollower(id)!;
}

export function getFollower(id: string): Follower | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM followers WHERE id = ?").get(id) as FollowerRow | null;
  return row ? rowToFollower(row) : null;
}

export function listFollowers(accountId: string, filters: ListFollowersFilters = {}): Follower[] {
  const db = getDatabase();
  const conditions: string[] = ["account_id = ?"];
  const params: unknown[] = [accountId];

  if (filters.following !== undefined) {
    conditions.push("following = ?");
    params.push(filters.following ? 1 : 0);
  }

  if (filters.search) {
    conditions.push("(username LIKE ? OR display_name LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  let sql = `SELECT * FROM followers WHERE ${conditions.join(" AND ")} ORDER BY follower_count DESC`;

  if (filters.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }
  if (filters.offset) {
    sql += " OFFSET ?";
    params.push(filters.offset);
  }

  const rows = db.prepare(sql).all(...params) as FollowerRow[];
  return rows.map(rowToFollower);
}

export function updateFollower(id: string, input: UpdateFollowerInput): Follower | null {
  const db = getDatabase();
  const existing = getFollower(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.username !== undefined) {
    sets.push("username = ?");
    params.push(input.username);
  }
  if (input.display_name !== undefined) {
    sets.push("display_name = ?");
    params.push(input.display_name);
  }
  if (input.follower_count !== undefined) {
    sets.push("follower_count = ?");
    params.push(input.follower_count);
  }
  if (input.following !== undefined) {
    sets.push("following = ?");
    params.push(input.following ? 1 : 0);
  }
  if (input.unfollowed_at !== undefined) {
    sets.push("unfollowed_at = ?");
    params.push(input.unfollowed_at);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE followers SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getFollower(id);
}

export function removeFollower(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM followers WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---- Sync ----

export interface SyncResult {
  synced: number;
  new_followers: number;
  unfollowed: number;
  message: string;
}

/**
 * Stub that would call the platform API for follower list, upsert into DB.
 * In production this would call X/Instagram/LinkedIn APIs.
 */
export function syncFollowers(accountId: string): SyncResult {
  // In a real implementation, this would:
  // 1. Call the platform API to get the current follower list
  // 2. Upsert new followers into the DB
  // 3. Mark unfollowed users (following=0, set unfollowed_at)
  // 4. Update follower metadata (display_name, follower_count)

  const db = getDatabase();
  const currentFollowers = db.prepare(
    "SELECT COUNT(*) as count FROM followers WHERE account_id = ? AND following = 1"
  ).get(accountId) as { count: number };

  return {
    synced: currentFollowers.count,
    new_followers: 0,
    unfollowed: 0,
    message: "Sync stub — connect platform API credentials to enable live sync.",
  };
}

// ---- Snapshots ----

export function createSnapshot(
  accountId: string,
  followerCount: number,
  followingCount: number
): AudienceSnapshot {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO audience_snapshots (id, account_id, follower_count, following_count)
     VALUES (?, ?, ?, ?)`
  ).run(id, accountId, followerCount, followingCount);

  return db.prepare("SELECT * FROM audience_snapshots WHERE id = ?").get(id) as AudienceSnapshot;
}

/**
 * Creates a daily snapshot from current follower counts in the DB.
 */
export function trackGrowth(accountId: string): AudienceSnapshot {
  const db = getDatabase();

  const followerCount = (
    db.prepare(
      "SELECT COUNT(*) as count FROM followers WHERE account_id = ? AND following = 1"
    ).get(accountId) as { count: number }
  ).count;

  const followingCount = (
    db.prepare(
      "SELECT COUNT(*) as count FROM followers WHERE account_id = ? AND following = 0"
    ).get(accountId) as { count: number }
  ).count;

  return createSnapshot(accountId, followerCount, followingCount);
}

// ---- Insights ----

export function getAudienceInsights(accountId: string): AudienceInsights {
  const db = getDatabase();

  // Total current followers
  const total_followers = (
    db.prepare(
      "SELECT COUNT(*) as count FROM followers WHERE account_id = ? AND following = 1"
    ).get(accountId) as { count: number }
  ).count;

  // New followers in last 7 days
  const new_followers_7d = (
    db.prepare(
      "SELECT COUNT(*) as count FROM followers WHERE account_id = ? AND following = 1 AND created_at >= datetime('now', '-7 days')"
    ).get(accountId) as { count: number }
  ).count;

  // Lost followers in last 7 days
  const lost_followers_7d = (
    db.prepare(
      "SELECT COUNT(*) as count FROM followers WHERE account_id = ? AND following = 0 AND unfollowed_at >= datetime('now', '-7 days')"
    ).get(accountId) as { count: number }
  ).count;

  // Growth rates from snapshots
  const growth_rate_7d = calculateGrowthRate(accountId, 7);
  const growth_rate_30d = calculateGrowthRate(accountId, 30);

  // Top followers by their follower count
  const top_followers = listFollowers(accountId, { following: true, limit: 10 });

  return {
    total_followers,
    growth_rate_7d,
    growth_rate_30d,
    new_followers_7d,
    lost_followers_7d,
    top_followers,
  };
}

function calculateGrowthRate(accountId: string, days: number): number {
  const db = getDatabase();

  const latest = db.prepare(
    "SELECT follower_count FROM audience_snapshots WHERE account_id = ? ORDER BY snapshot_at DESC LIMIT 1"
  ).get(accountId) as { follower_count: number } | null;

  const older = db.prepare(
    `SELECT follower_count FROM audience_snapshots WHERE account_id = ? AND snapshot_at <= datetime('now', '-${days} days') ORDER BY snapshot_at DESC LIMIT 1`
  ).get(accountId) as { follower_count: number } | null;

  if (!latest || !older || older.follower_count === 0) return 0;

  return Math.round(((latest.follower_count - older.follower_count) / older.follower_count) * 10000) / 100;
}

// ---- Growth Chart ----

export function getFollowerGrowthChart(accountId: string, days: number = 30): GrowthPoint[] {
  const db = getDatabase();

  const rows = db.prepare(
    `SELECT date(snapshot_at) as date, MAX(follower_count) as count
     FROM audience_snapshots
     WHERE account_id = ? AND snapshot_at >= datetime('now', '-${days} days')
     GROUP BY date(snapshot_at)
     ORDER BY date ASC`
  ).all(accountId) as GrowthPoint[];

  return rows;
}

// ---- Top Followers ----

export function getTopFollowers(accountId: string, limit: number = 10): Follower[] {
  return listFollowers(accountId, { following: true, limit });
}
