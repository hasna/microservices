/**
 * Post CRUD operations
 */

import { getDatabase } from "./database.js";
import type { PostStatus, Recurrence } from "./types.js";

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
