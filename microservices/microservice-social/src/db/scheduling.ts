/**
 * Scheduling, cross-posting, approval workflow, and recurring post operations
 */

import { getAccount, listAccounts, checkPlatformLimit } from "./accounts.js";
import { createPost, getPost, updatePost } from "./posts.js";
import { PLATFORM_LIMITS } from "./types.js";
import type { Platform, Recurrence, PlatformLimitWarning } from "./types.js";
import type { Post } from "./posts.js";

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

export type { CreatePostInput } from "./posts.js";

/**
 * Create a recurring post — sets recurrence and schedules the first instance
 */
export function createRecurringPost(input: import("./posts.js").CreatePostInput & { recurrence: Recurrence }): Post {
  if (!input.scheduled_at) {
    throw new Error("Recurring posts must have a scheduled_at date for the first occurrence.");
  }

  return createPost({
    ...input,
    status: "scheduled",
  });
}
