/**
 * Scheduled post publishing worker
 *
 * Checks for posts where scheduled_at <= now AND status = 'scheduled',
 * marks them as published, and handles recurrence by creating the next
 * scheduled post.
 */

import {
  getPost,
  listPosts,
  updatePost,
  createPost,
  publishPost,
  type Post,
  type Recurrence,
} from "../db/social.js";

// ---- Types ----

export interface SchedulerStatus {
  running: boolean;
  lastCheck: string | null;
  postsProcessed: number;
  errors: number;
}

export interface ProcessResult {
  postId: string;
  published: boolean;
  error?: string;
  nextPostId?: string;
}

// ---- State ----

let _interval: ReturnType<typeof setInterval> | null = null;
let _status: SchedulerStatus = {
  running: false,
  lastCheck: null,
  postsProcessed: 0,
  errors: 0,
};

// ---- Core Functions ----

/**
 * Find all posts where scheduled_at <= now AND status = 'scheduled'
 */
export function getDuePosts(now?: Date): Post[] {
  const currentTime = now || new Date();
  const posts = listPosts({ status: "scheduled" });

  return posts.filter((post) => {
    if (!post.scheduled_at) return false;
    const scheduledTime = new Date(post.scheduled_at.replace(" ", "T") + (post.scheduled_at.includes("Z") ? "" : "Z"));
    return scheduledTime <= currentTime;
  });
}

/**
 * Attempt to publish a scheduled post.
 * Marks the post as published locally. When a publisher module is available,
 * it would call the platform API first.
 */
export function processScheduledPost(postId: string): ProcessResult {
  const post = getPost(postId);
  if (!post) {
    return { postId, published: false, error: `Post '${postId}' not found` };
  }

  if (post.status !== "scheduled") {
    return { postId, published: false, error: `Post status is '${post.status}', expected 'scheduled'` };
  }

  try {
    // Mark as published locally (future: call platform API via publisher.ts)
    publishPost(postId);

    const result: ProcessResult = { postId, published: true };

    // Handle recurrence
    if (post.recurrence) {
      const nextPost = handleRecurrence(postId);
      if (nextPost) {
        result.nextPostId = nextPost.id;
      }
    }

    return result;
  } catch (err) {
    // Mark as failed
    updatePost(postId, { status: "failed" });
    return {
      postId,
      published: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * If post has recurrence (daily/weekly/biweekly/monthly), create the next
 * scheduled post with the same content, account, tags, and media.
 */
export function handleRecurrence(postId: string): Post | null {
  const post = getPost(postId);
  if (!post || !post.recurrence || !post.scheduled_at) return null;

  const nextDate = computeNextDate(post.scheduled_at, post.recurrence);

  const nextPost = createPost({
    account_id: post.account_id,
    content: post.content,
    media_urls: post.media_urls.length > 0 ? post.media_urls : undefined,
    status: "scheduled",
    scheduled_at: nextDate,
    tags: post.tags.length > 0 ? post.tags : undefined,
    recurrence: post.recurrence,
  });

  return nextPost;
}

/**
 * Compute the next scheduled date based on recurrence type
 */
export function computeNextDate(scheduledAt: string, recurrence: Recurrence): string {
  const date = new Date(scheduledAt.replace(" ", "T") + (scheduledAt.includes("Z") ? "" : "Z"));

  switch (recurrence) {
    case "daily":
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case "weekly":
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case "biweekly":
      date.setUTCDate(date.getUTCDate() + 14);
      break;
    case "monthly":
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
  }

  // Format as YYYY-MM-DD HH:MM:SS to match the existing convention
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");

  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

// ---- Scheduler Loop ----

/**
 * Run one check cycle: find due posts and process them.
 * Returns an array of results.
 */
export function runOnce(now?: Date): ProcessResult[] {
  const duePosts = getDuePosts(now);
  const results: ProcessResult[] = [];

  for (const post of duePosts) {
    const result = processScheduledPost(post.id);
    results.push(result);

    if (result.published) {
      _status.postsProcessed++;
    } else {
      _status.errors++;
    }
  }

  _status.lastCheck = new Date().toISOString();
  return results;
}

/**
 * Start the scheduler loop that checks for due posts at the given interval.
 */
export function startScheduler(intervalMs: number = 60000): void {
  if (_interval) {
    throw new Error("Scheduler is already running. Stop it first.");
  }

  _status.running = true;
  _status.lastCheck = new Date().toISOString();

  // Run immediately on start
  runOnce();

  _interval = setInterval(() => {
    runOnce();
  }, intervalMs);
}

/**
 * Stop the scheduler loop.
 */
export function stopScheduler(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  _status.running = false;
}

/**
 * Get the current scheduler status.
 */
export function getSchedulerStatus(): SchedulerStatus {
  return { ..._status };
}

/**
 * Reset scheduler status counters (useful for testing).
 */
export function resetSchedulerStatus(): void {
  _status = {
    running: _interval !== null,
    lastCheck: null,
    postsProcessed: 0,
    errors: 0,
  };
}
