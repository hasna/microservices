/**
 * Social media CRUD operations and analytics
 */

import { getDatabase } from "./database.js";

// ---- Types ----

export type Platform = "x" | "linkedin" | "instagram" | "threads" | "bluesky";
export type PostStatus = "draft" | "scheduled" | "published" | "failed" | "pending_review";

export type Recurrence = "daily" | "weekly" | "biweekly" | "monthly";

/**
 * Platform character limits for post content validation
 */
export const PLATFORM_LIMITS: Record<Platform, number> = {
  x: 280,
  linkedin: 3000,
  instagram: 2200,
  threads: 500,
  bluesky: 300,
};

export interface PlatformLimitWarning {
  platform: Platform;
  limit: number;
  content_length: number;
  over_by: number;
}

/**
 * Check if content exceeds platform character limit for a given account
 */
export function checkPlatformLimit(content: string, accountId: string): PlatformLimitWarning | null {
  const account = getAccount(accountId);
  if (!account) return null;

  const limit = PLATFORM_LIMITS[account.platform];
  if (content.length > limit) {
    return {
      platform: account.platform,
      limit,
      content_length: content.length,
      over_by: content.length - limit,
    };
  }
  return null;
}

export interface Account {
  id: string;
  platform: Platform;
  handle: string;
  display_name: string | null;
  connected: boolean;
  access_token_env: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AccountRow {
  id: string;
  platform: string;
  handle: string;
  display_name: string | null;
  connected: number;
  access_token_env: string | null;
  metadata: string;
  created_at: string;
}

function rowToAccount(row: AccountRow): Account {
  return {
    ...row,
    platform: row.platform as Platform,
    connected: row.connected === 1,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface Engagement {
  likes?: number;
  shares?: number;
  comments?: number;
  impressions?: number;
  clicks?: number;
}

export interface Post {
  id: string;
  account_id: string;
  content: string;
  media_urls: string[];
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  platform_post_id: string | null;
  engagement: Engagement;
  tags: string[];
  recurrence: Recurrence | null;
  thread_id: string | null;
  thread_position: number | null;
  created_at: string;
  updated_at: string;
}

interface PostRow {
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
  thread_id: string | null;
  thread_position: number | null;
  created_at: string;
  updated_at: string;
}

function rowToPost(row: PostRow): Post {
  return {
    ...row,
    status: row.status as PostStatus,
    media_urls: JSON.parse(row.media_urls || "[]"),
    engagement: JSON.parse(row.engagement || "{}"),
    tags: JSON.parse(row.tags || "[]"),
    recurrence: (row.recurrence as Recurrence) || null,
    thread_id: row.thread_id || null,
    thread_position: row.thread_position ?? null,
  };
}

export interface Template {
  id: string;
  name: string;
  content: string;
  variables: string[];
  created_at: string;
}

interface TemplateRow {
  id: string;
  name: string;
  content: string;
  variables: string;
  created_at: string;
}

function rowToTemplate(row: TemplateRow): Template {
  return {
    ...row,
    variables: JSON.parse(row.variables || "[]"),
  };
}

// ---- Accounts ----

export interface CreateAccountInput {
  platform: Platform;
  handle: string;
  display_name?: string;
  connected?: boolean;
  access_token_env?: string;
  metadata?: Record<string, unknown>;
}

export function createAccount(input: CreateAccountInput): Account {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO accounts (id, platform, handle, display_name, connected, access_token_env, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.platform,
    input.handle,
    input.display_name || null,
    input.connected ? 1 : 0,
    input.access_token_env || null,
    metadata
  );

  return getAccount(id)!;
}

export function getAccount(id: string): Account | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | null;
  return row ? rowToAccount(row) : null;
}

export interface ListAccountsOptions {
  platform?: Platform;
  connected?: boolean;
  limit?: number;
}

export function listAccounts(options: ListAccountsOptions = {}): Account[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.platform) {
    conditions.push("platform = ?");
    params.push(options.platform);
  }

  if (options.connected !== undefined) {
    conditions.push("connected = ?");
    params.push(options.connected ? 1 : 0);
  }

  let sql = "SELECT * FROM accounts";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params) as AccountRow[];
  return rows.map(rowToAccount);
}

export interface UpdateAccountInput {
  platform?: Platform;
  handle?: string;
  display_name?: string;
  connected?: boolean;
  access_token_env?: string;
  metadata?: Record<string, unknown>;
}

export function updateAccount(id: string, input: UpdateAccountInput): Account | null {
  const db = getDatabase();
  const existing = getAccount(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.platform !== undefined) {
    sets.push("platform = ?");
    params.push(input.platform);
  }
  if (input.handle !== undefined) {
    sets.push("handle = ?");
    params.push(input.handle);
  }
  if (input.display_name !== undefined) {
    sets.push("display_name = ?");
    params.push(input.display_name);
  }
  if (input.connected !== undefined) {
    sets.push("connected = ?");
    params.push(input.connected ? 1 : 0);
  }
  if (input.access_token_env !== undefined) {
    sets.push("access_token_env = ?");
    params.push(input.access_token_env);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getAccount(id);
}

export function deleteAccount(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countAccounts(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM accounts").get() as { count: number };
  return row.count;
}

// ---- Posts ----

export interface CreatePostInput {
  account_id: string;
  content: string;
  media_urls?: string[];
  status?: PostStatus;
  scheduled_at?: string;
  tags?: string[];
  recurrence?: Recurrence;
  thread_id?: string;
  thread_position?: number;
}

export function createPost(input: CreatePostInput): Post {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const media_urls = JSON.stringify(input.media_urls || []);
  const tags = JSON.stringify(input.tags || []);

  db.prepare(
    `INSERT INTO posts (id, account_id, content, media_urls, status, scheduled_at, tags, recurrence, thread_id, thread_position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.account_id,
    input.content,
    media_urls,
    input.status || "draft",
    input.scheduled_at || null,
    tags,
    input.recurrence || null,
    input.thread_id || null,
    input.thread_position ?? null
  );

  return getPost(id)!;
}

export function getPost(id: string): Post | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRow | null;
  return row ? rowToPost(row) : null;
}

export interface ListPostsOptions {
  account_id?: string;
  status?: PostStatus;
  tag?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listPosts(options: ListPostsOptions = {}): Post[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.account_id) {
    conditions.push("account_id = ?");
    params.push(options.account_id);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.tag) {
    conditions.push("tags LIKE ?");
    params.push(`%"${options.tag}"%`);
  }

  if (options.search) {
    conditions.push("content LIKE ?");
    params.push(`%${options.search}%`);
  }

  let sql = "SELECT * FROM posts";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as PostRow[];
  return rows.map(rowToPost);
}

export interface UpdatePostInput {
  content?: string;
  media_urls?: string[];
  status?: PostStatus;
  scheduled_at?: string | null;
  published_at?: string | null;
  platform_post_id?: string;
  engagement?: Engagement;
  tags?: string[];
  recurrence?: Recurrence | null;
}

export function updatePost(id: string, input: UpdatePostInput): Post | null {
  const db = getDatabase();
  const existing = getPost(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.content !== undefined) {
    sets.push("content = ?");
    params.push(input.content);
  }
  if (input.media_urls !== undefined) {
    sets.push("media_urls = ?");
    params.push(JSON.stringify(input.media_urls));
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.scheduled_at !== undefined) {
    sets.push("scheduled_at = ?");
    params.push(input.scheduled_at);
  }
  if (input.published_at !== undefined) {
    sets.push("published_at = ?");
    params.push(input.published_at);
  }
  if (input.platform_post_id !== undefined) {
    sets.push("platform_post_id = ?");
    params.push(input.platform_post_id);
  }
  if (input.engagement !== undefined) {
    sets.push("engagement = ?");
    params.push(JSON.stringify(input.engagement));
  }
  if (input.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(input.tags));
  }
  if (input.recurrence !== undefined) {
    sets.push("recurrence = ?");
    params.push(input.recurrence);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getPost(id);
}

export function deletePost(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countPosts(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM posts").get() as { count: number };
  return row.count;
}

/**
 * Get all posts in a thread, ordered by thread_position
 */
export function getThreadPosts(threadId: string): Post[] {
  const db = getDatabase();
  const rows = db.prepare(
    "SELECT * FROM posts WHERE thread_id = ? ORDER BY thread_position ASC"
  ).all(threadId) as PostRow[];
  return rows.map(rowToPost);
}

/**
 * Delete all posts in a thread
 */
export function deleteThreadPosts(threadId: string): number {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM posts WHERE thread_id = ?").run(threadId);
  return result.changes;
}

/**
 * Schedule a post — sets status to 'scheduled' and sets scheduled_at
 */
export function schedulePost(id: string, scheduledAt: string): Post | null {
  return updatePost(id, { status: "scheduled", scheduled_at: scheduledAt });
}

/**
 * Mark a post as published
 */
export function publishPost(id: string, platformPostId?: string): Post | null {
  return updatePost(id, {
    status: "published",
    published_at: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
    platform_post_id: platformPostId,
  });
}

// ---- Templates ----

export interface CreateTemplateInput {
  name: string;
  content: string;
  variables?: string[];
}

export function createTemplate(input: CreateTemplateInput): Template {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const variables = JSON.stringify(input.variables || []);

  db.prepare(
    `INSERT INTO templates (id, name, content, variables)
     VALUES (?, ?, ?, ?)`
  ).run(id, input.name, input.content, variables);

  return getTemplate(id)!;
}

export function getTemplate(id: string): Template | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(id) as TemplateRow | null;
  return row ? rowToTemplate(row) : null;
}

export function listTemplates(): Template[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM templates ORDER BY name").all() as TemplateRow[];
  return rows.map(rowToTemplate);
}

export function deleteTemplate(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM templates WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Use a template to create a post — replaces {{variable}} with values
 */
export function useTemplate(
  templateId: string,
  accountId: string,
  values: Record<string, string>,
  tags?: string[]
): Post {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Template '${templateId}' not found`);

  let content = template.content;
  for (const [key, value] of Object.entries(values)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return createPost({
    account_id: accountId,
    content,
    tags,
  });
}

// ---- Analytics ----

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
  const db = getDatabase();
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
export function getCalendar(startDate?: string, endDate?: string): Record<string, Post[]> {
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
  const rows = db.prepare(sql).all(...params) as PostRow[];
  const posts = rows.map(rowToPost);

  const calendar: Record<string, Post[]> = {};
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

// ---- Bulk Schedule ----

export interface BatchScheduleInput {
  account_id: string;
  content: string;
  scheduled_at: string;
  media_urls?: string[];
  tags?: string[];
  recurrence?: Recurrence;
}

export interface BatchScheduleResult {
  scheduled: Post[];
  errors: { index: number; error: string }[];
  warnings: PlatformLimitWarning[];
}

/**
 * Schedule multiple posts at once from an array of post definitions
 */
export function batchSchedule(posts: BatchScheduleInput[]): BatchScheduleResult {
  const scheduled: Post[] = [];
  const errors: { index: number; error: string }[] = [];
  const warnings: PlatformLimitWarning[] = [];

  for (let i = 0; i < posts.length; i++) {
    const input = posts[i];
    try {
      // Validate account exists
      const account = getAccount(input.account_id);
      if (!account) {
        errors.push({ index: i, error: `Account '${input.account_id}' not found` });
        continue;
      }

      // Check platform limit
      const warning = checkPlatformLimit(input.content, input.account_id);
      if (warning) {
        warnings.push(warning);
      }

      const post = createPost({
        account_id: input.account_id,
        content: input.content,
        media_urls: input.media_urls,
        status: "scheduled",
        scheduled_at: input.scheduled_at,
        tags: input.tags,
        recurrence: input.recurrence,
      });

      scheduled.push(post);
    } catch (err) {
      errors.push({ index: i, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { scheduled, errors, warnings };
}

// ---- Cross-Post ----

export interface CrossPostResult {
  posts: Post[];
  warnings: PlatformLimitWarning[];
}

/**
 * Create identical post on multiple platform accounts
 */
export function crossPost(
  content: string,
  platforms: Platform[],
  options?: { media_urls?: string[]; tags?: string[]; scheduled_at?: string }
): CrossPostResult {
  const posts: Post[] = [];
  const warnings: PlatformLimitWarning[] = [];

  for (const platform of platforms) {
    // Find an account for this platform
    const accounts = listAccounts({ platform });
    if (accounts.length === 0) {
      throw new Error(`No account found for platform '${platform}'`);
    }

    const account = accounts[0]; // Use first matching account

    // Check platform limit
    const limit = PLATFORM_LIMITS[platform];
    if (content.length > limit) {
      warnings.push({
        platform,
        limit,
        content_length: content.length,
        over_by: content.length - limit,
      });
    }

    const post = createPost({
      account_id: account.id,
      content,
      media_urls: options?.media_urls,
      status: options?.scheduled_at ? "scheduled" : "draft",
      scheduled_at: options?.scheduled_at,
      tags: options?.tags,
    });

    posts.push(post);
  }

  return { posts, warnings };
}

// ---- Best Time to Post ----

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

// ---- Reschedule ----

/**
 * Update scheduled_at on a post without delete/recreate
 */
export function reschedulePost(id: string, newDate: string): Post | null {
  const post = getPost(id);
  if (!post) return null;

  if (post.status !== "scheduled" && post.status !== "draft") {
    throw new Error(`Cannot reschedule post with status '${post.status}'. Must be 'draft' or 'scheduled'.`);
  }

  return updatePost(id, { scheduled_at: newDate, status: "scheduled" });
}

// ---- Approval Workflow ----

/**
 * Submit a draft post for review — moves draft→pending_review
 */
export function submitPostForReview(id: string): Post | null {
  const post = getPost(id);
  if (!post) return null;

  if (post.status !== "draft") {
    throw new Error(`Cannot submit post with status '${post.status}'. Must be 'draft'.`);
  }

  return updatePost(id, { status: "pending_review" });
}

/**
 * Approve a post — moves pending_review→scheduled (requires scheduled_at)
 */
export function approvePost(id: string, scheduledAt?: string): Post | null {
  const post = getPost(id);
  if (!post) return null;

  if (post.status !== "pending_review") {
    throw new Error(`Cannot approve post with status '${post.status}'. Must be 'pending_review'.`);
  }

  const targetDate = scheduledAt || post.scheduled_at;
  if (!targetDate) {
    throw new Error("Cannot approve post without a scheduled date. Provide --at <datetime>.");
  }

  return updatePost(id, { status: "scheduled", scheduled_at: targetDate });
}

// ---- Recurring Posts ----

/**
 * Create a recurring post — sets recurrence and schedules the first instance
 */
export function createRecurringPost(input: CreatePostInput & { recurrence: Recurrence }): Post {
  if (!input.scheduled_at) {
    throw new Error("Recurring posts must have a scheduled_at date for the first occurrence.");
  }

  return createPost({
    ...input,
    status: "scheduled",
  });
}

// ---- Hashtag Analytics ----

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
