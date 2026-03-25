/**
 * Social media CRUD operations and analytics
 *
 * This module re-exports all social media functionality from sub-modules.
 * Imports from this file continue to work unchanged.
 */

// Shared types and constants
export type { Platform, PostStatus, Recurrence, PlatformLimitWarning } from "./types.js";
export { PLATFORM_LIMITS } from "./types.js";

// Accounts
export type { Account, CreateAccountInput, ListAccountsOptions, UpdateAccountInput } from "./accounts.js";
export {
  createAccount,
  getAccount,
  listAccounts,
  updateAccount,
  deleteAccount,
  countAccounts,
  checkPlatformLimit,
} from "./accounts.js";

// Posts
export type { Engagement, Post, CreatePostInput, ListPostsOptions, UpdatePostInput } from "./posts.js";
export {
  createPost,
  getPost,
  listPosts,
  updatePost,
  deletePost,
  countPosts,
  getThreadPosts,
  deleteThreadPosts,
  schedulePost,
  publishPost,
} from "./posts.js";

// Templates
export type { Template, CreateTemplateInput } from "./templates.js";
export { createTemplate, getTemplate, listTemplates, deleteTemplate, useTemplate } from "./templates.js";

// Analytics
export type { EngagementStats, PlatformStats, BestTimeSlot, BestTimeResult, HashtagStat } from "./analytics.js";
export {
  getEngagementStats,
  getStatsByPlatform,
  getCalendar,
  getOverallStats,
  getBestTimeToPost,
  getHashtagStats,
} from "./analytics.js";

// Scheduling, cross-posting, approval, recurring
export type { BatchScheduleInput, BatchScheduleResult, CrossPostResult } from "./scheduling.js";
export {
  batchSchedule,
  crossPost,
  reschedulePost,
  submitPostForReview,
  approvePost,
  createRecurringPost,
} from "./scheduling.js";
