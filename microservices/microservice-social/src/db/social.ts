/**
 * Social media CRUD operations and analytics
 */

import { getDatabase } from "./database.js";

// ---- Types ----

export type Platform = "x" | "linkedin" | "instagram" | "threads" | "bluesky";
export type PostStatus = "draft" | "scheduled" | "published" | "failed";

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
}

export function createPost(input: CreatePostInput): Post {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const media_urls = JSON.stringify(input.media_urls || []);
  const tags = JSON.stringify(input.tags || []);

  db.prepare(
    `INSERT INTO posts (id, account_id, content, media_urls, status, scheduled_at, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.account_id,
    input.content,
    media_urls,
    input.status || "draft",
    input.scheduled_at || null,
    tags
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
