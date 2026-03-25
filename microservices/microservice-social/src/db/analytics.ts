/**
 * Analytics and reporting operations
 */

import { getDatabase } from "./database.js";
import { listAccounts, countAccounts } from "./accounts.js";
import { listPosts, countPosts } from "./posts.js";
import type { Platform } from "./types.js";
import type { Engagement } from "./posts.js";

export interface EngagementStats {
  total_posts: number;
  total_likes: number;
  total_shares: number;
  total_comments: number;
  total_impressions: number;
  total_clicks: number;
  avg_likes: number;
  avg_shares: number;
  avg_comments: number;
  avg_impressions: number;
  avg_clicks: number;
}

/**
 * Get engagement analytics for a specific account or across all accounts
 */
export function getEngagementStats(accountId?: string): EngagementStats {
  const db = getDatabase();
  let sql = "SELECT engagement FROM posts WHERE status = 'published'";
  const params: unknown[] = [];

  if (accountId) {
    sql += " AND account_id = ?";
    params.push(accountId);
  }

  const rows = db.prepare(sql).all(...params) as { engagement: string }[];
  const engagements = rows.map((r) => JSON.parse(r.engagement || "{}") as Engagement);

  const total_posts = engagements.length;
  const total_likes = engagements.reduce((sum, e) => sum + (e.likes || 0), 0);
  const total_shares = engagements.reduce((sum, e) => sum + (e.shares || 0), 0);
  const total_comments = engagements.reduce((sum, e) => sum + (e.comments || 0), 0);
  const total_impressions = engagements.reduce((sum, e) => sum + (e.impressions || 0), 0);
  const total_clicks = engagements.reduce((sum, e) => sum + (e.clicks || 0), 0);

  return {
    total_posts,
    total_likes,
    total_shares,
    total_comments,
    total_impressions,
    total_clicks,
    avg_likes: total_posts > 0 ? Math.round(total_likes / total_posts) : 0,
    avg_shares: total_posts > 0 ? Math.round(total_shares / total_posts) : 0,
    avg_comments: total_posts > 0 ? Math.round(total_comments / total_posts) : 0,
    avg_impressions: total_posts > 0 ? Math.round(total_impressions / total_posts) : 0,
    avg_clicks: total_posts > 0 ? Math.round(total_clicks / total_posts) : 0,
  };
}

export interface PlatformStats {
  platform: Platform;
  account_count: number;
  post_count: number;
  engagement: EngagementStats;
}

/**
 * Get analytics grouped by platform
 */
export function getStatsByPlatform(): PlatformStats[] {
  const accounts = listAccounts();
  const platforms = [...new Set(accounts.map((a) => a.platform))];

  return platforms.map((platform) => {
    const platformAccounts = accounts.filter((a) => a.platform === platform);
    const accountIds = platformAccounts.map((a) => a.id);

    let post_count = 0;
    const allEngagements: Engagement[] = [];

    for (const accountId of accountIds) {
      const posts = listPosts({ account_id: accountId });
      post_count += posts.length;
      const published = posts.filter((p) => p.status === "published");
      allEngagements.push(...published.map((p) => p.engagement));
    }

    const total_posts = allEngagements.length;
    const total_likes = allEngagements.reduce((sum, e) => sum + (e.likes || 0), 0);
    const total_shares = allEngagements.reduce((sum, e) => sum + (e.shares || 0), 0);
    const total_comments = allEngagements.reduce((sum, e) => sum + (e.comments || 0), 0);
    const total_impressions = allEngagements.reduce((sum, e) => sum + (e.impressions || 0), 0);
    const total_clicks = allEngagements.reduce((sum, e) => sum + (e.clicks || 0), 0);

    return {
      platform,
      account_count: platformAccounts.length,
      post_count,
      engagement: {
        total_posts,
        total_likes,
        total_shares,
        total_comments,
        total_impressions,
        total_clicks,
        avg_likes: total_posts > 0 ? Math.round(total_likes / total_posts) : 0,
        avg_shares: total_posts > 0 ? Math.round(total_shares / total_posts) : 0,
        avg_comments: total_posts > 0 ? Math.round(total_comments / total_posts) : 0,
        avg_impressions: total_posts > 0 ? Math.round(total_impressions / total_posts) : 0,
        avg_clicks: total_posts > 0 ? Math.round(total_clicks / total_posts) : 0,
      },
    };
  });
}

/**
 * Get scheduled posts grouped by date (calendar view)
 */
export function getCalendar(startDate?: string, endDate?: string): Record<string, import("./posts.js").Post[]> {
  const db = getDatabase();
  const conditions: string[] = ["status = 'scheduled'", "scheduled_at IS NOT NULL"];
  const params: unknown[] = [];

  if (startDate) {
    conditions.push("scheduled_at >= ?");
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("scheduled_at <= ?");
    params.push(endDate);
  }

  const sql = `SELECT * FROM posts WHERE ${conditions.join(" AND ")} ORDER BY scheduled_at`;

  type PostRow = {
    id: string; account_id: string; content: string; media_urls: string; status: string;
    scheduled_at: string | null; published_at: string | null; platform_post_id: string | null;
    engagement: string; tags: string; recurrence: string | null; thread_id: string | null;
    thread_position: number | null; created_at: string; updated_at: string;
  };

  const rows = db.prepare(sql).all(...params) as PostRow[];
  const posts = rows.map((row) => ({
    ...row,
    status: row.status as import("./types.js").PostStatus,
    media_urls: JSON.parse(row.media_urls || "[]"),
    engagement: JSON.parse(row.engagement || "{}"),
    tags: JSON.parse(row.tags || "[]"),
    recurrence: (row.recurrence as import("./types.js").Recurrence) || null,
    thread_id: row.thread_id || null,
    thread_position: row.thread_position ?? null,
  }));

  const calendar: Record<string, typeof posts> = {};
  for (const post of posts) {
    const date = post.scheduled_at!.split(" ")[0].split("T")[0];
    if (!calendar[date]) calendar[date] = [];
    calendar[date].push(post);
  }

  return calendar;
}

/**
 * Get overall stats summary
 */
export function getOverallStats(): {
  total_accounts: number;
  total_posts: number;
  posts_by_status: Record<string, number>;
  total_templates: number;
  engagement: EngagementStats;
} {
  const db = getDatabase();
  const total_accounts = countAccounts();
  const total_posts = countPosts();
  const total_templates = (db.prepare("SELECT COUNT(*) as count FROM templates").get() as { count: number }).count;

  // Posts by status
  const statusRows = db
    .prepare("SELECT status, COUNT(*) as count FROM posts GROUP BY status")
    .all() as { status: string; count: number }[];
  const posts_by_status: Record<string, number> = {};
  for (const row of statusRows) {
    posts_by_status[row.status] = row.count;
  }

  const engagement = getEngagementStats();

  return {
    total_accounts,
    total_posts,
    posts_by_status,
    total_templates,
    engagement,
  };
}

export interface BestTimeSlot {
  day_of_week: number; // 0=Sunday, 6=Saturday
  day_name: string;
  hour: number;
  avg_engagement: number;
  post_count: number;
}

export interface BestTimeResult {
  best_hours: BestTimeSlot[];
  best_days: { day_of_week: number; day_name: string; avg_engagement: number; post_count: number }[];
  total_analyzed: number;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Analyze historical engagement data to find best time to post
 */
export function getBestTimeToPost(accountId: string): BestTimeResult {
  const db = getDatabase();
  const rows = db.prepare(
    "SELECT published_at, engagement FROM posts WHERE account_id = ? AND status = 'published' AND published_at IS NOT NULL"
  ).all(accountId) as { published_at: string; engagement: string }[];

  if (rows.length === 0) {
    return { best_hours: [], best_days: [], total_analyzed: 0 };
  }

  // Group by day of week and hour
  const hourBuckets: Record<string, { total_engagement: number; count: number; day: number; hour: number }> = {};
  const dayBuckets: Record<number, { total_engagement: number; count: number }> = {};

  for (const row of rows) {
    const date = new Date(row.published_at.replace(" ", "T"));
    const dayOfWeek = date.getUTCDay();
    const hour = date.getUTCHours();
    const engagement = JSON.parse(row.engagement || "{}") as Engagement;
    const totalEng = (engagement.likes || 0) + (engagement.shares || 0) * 2 +
      (engagement.comments || 0) * 3 + (engagement.clicks || 0);

    const key = `${dayOfWeek}-${hour}`;
    if (!hourBuckets[key]) {
      hourBuckets[key] = { total_engagement: 0, count: 0, day: dayOfWeek, hour };
    }
    hourBuckets[key].total_engagement += totalEng;
    hourBuckets[key].count += 1;

    if (!dayBuckets[dayOfWeek]) {
      dayBuckets[dayOfWeek] = { total_engagement: 0, count: 0 };
    }
    dayBuckets[dayOfWeek].total_engagement += totalEng;
    dayBuckets[dayOfWeek].count += 1;
  }

  // Sort hours by avg engagement
  const best_hours: BestTimeSlot[] = Object.values(hourBuckets)
    .map((b) => ({
      day_of_week: b.day,
      day_name: DAY_NAMES[b.day],
      hour: b.hour,
      avg_engagement: b.count > 0 ? Math.round(b.total_engagement / b.count) : 0,
      post_count: b.count,
    }))
    .sort((a, b) => b.avg_engagement - a.avg_engagement)
    .slice(0, 10);

  // Sort days by avg engagement
  const best_days = Object.entries(dayBuckets)
    .map(([day, b]) => ({
      day_of_week: parseInt(day),
      day_name: DAY_NAMES[parseInt(day)],
      avg_engagement: b.count > 0 ? Math.round(b.total_engagement / b.count) : 0,
      post_count: b.count,
    }))
    .sort((a, b) => b.avg_engagement - a.avg_engagement);

  return { best_hours, best_days, total_analyzed: rows.length };
}

export interface HashtagStat {
  hashtag: string;
  post_count: number;
  total_likes: number;
  total_shares: number;
  total_comments: number;
  total_impressions: number;
  avg_engagement: number;
}

/**
 * Extract hashtags from published posts and correlate with engagement
 */
export function getHashtagStats(accountId: string): HashtagStat[] {
  const db = getDatabase();
  const rows = db.prepare(
    "SELECT content, engagement FROM posts WHERE account_id = ? AND status = 'published'"
  ).all(accountId) as { content: string; engagement: string }[];

  const hashtagMap: Record<string, {
    count: number;
    likes: number;
    shares: number;
    comments: number;
    impressions: number;
  }> = {};

  const hashtagRegex = /#(\w+)/g;

  for (const row of rows) {
    const engagement = JSON.parse(row.engagement || "{}") as Engagement;
    const matches = row.content.matchAll(hashtagRegex);

    for (const match of matches) {
      const tag = match[1].toLowerCase();
      if (!hashtagMap[tag]) {
        hashtagMap[tag] = { count: 0, likes: 0, shares: 0, comments: 0, impressions: 0 };
      }
      hashtagMap[tag].count += 1;
      hashtagMap[tag].likes += engagement.likes || 0;
      hashtagMap[tag].shares += engagement.shares || 0;
      hashtagMap[tag].comments += engagement.comments || 0;
      hashtagMap[tag].impressions += engagement.impressions || 0;
    }
  }

  return Object.entries(hashtagMap)
    .map(([hashtag, data]) => ({
      hashtag,
      post_count: data.count,
      total_likes: data.likes,
      total_shares: data.shares,
      total_comments: data.comments,
      total_impressions: data.impressions,
      avg_engagement: data.count > 0
        ? Math.round((data.likes + data.shares * 2 + data.comments * 3) / data.count)
        : 0,
    }))
    .sort((a, b) => b.avg_engagement - a.avg_engagement);
}
