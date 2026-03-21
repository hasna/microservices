import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-social-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createAccount,
  getAccount,
  listAccounts,
  updateAccount,
  deleteAccount,
  countAccounts,
  createPost,
  getPost,
  listPosts,
  updatePost,
  deletePost,
  countPosts,
  schedulePost,
  publishPost,
  createTemplate,
  getTemplate,
  listTemplates,
  deleteTemplate,
  useTemplate,
  getEngagementStats,
  getStatsByPlatform,
  getCalendar,
  getOverallStats,
  batchSchedule,
  crossPost,
  getBestTimeToPost,
  reschedulePost,
  submitPostForReview,
  approvePost,
  createRecurringPost,
  getHashtagStats,
  checkPlatformLimit,
  PLATFORM_LIMITS,
} from "./social";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ---- Accounts ----

describe("Accounts", () => {
  test("create and get account", () => {
    const account = createAccount({
      platform: "x",
      handle: "testuser",
      display_name: "Test User",
      connected: true,
      access_token_env: "X_TOKEN",
    });

    expect(account.id).toBeTruthy();
    expect(account.platform).toBe("x");
    expect(account.handle).toBe("testuser");
    expect(account.display_name).toBe("Test User");
    expect(account.connected).toBe(true);
    expect(account.access_token_env).toBe("X_TOKEN");

    const fetched = getAccount(account.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(account.id);
    expect(fetched!.connected).toBe(true);
  });

  test("list accounts", () => {
    createAccount({ platform: "linkedin", handle: "linkedinuser" });
    const all = listAccounts();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list accounts by platform", () => {
    const xAccounts = listAccounts({ platform: "x" });
    expect(xAccounts.length).toBeGreaterThanOrEqual(1);
    expect(xAccounts.every((a) => a.platform === "x")).toBe(true);
  });

  test("list connected accounts", () => {
    const connected = listAccounts({ connected: true });
    expect(connected.length).toBeGreaterThanOrEqual(1);
    expect(connected.every((a) => a.connected === true)).toBe(true);
  });

  test("update account", () => {
    const account = createAccount({ platform: "instagram", handle: "iguser" });
    const updated = updateAccount(account.id, {
      display_name: "Instagram User",
      connected: true,
    });

    expect(updated).toBeDefined();
    expect(updated!.display_name).toBe("Instagram User");
    expect(updated!.connected).toBe(true);
  });

  test("delete account", () => {
    const account = createAccount({ platform: "threads", handle: "deleteme" });
    expect(deleteAccount(account.id)).toBe(true);
    expect(getAccount(account.id)).toBeNull();
  });

  test("count accounts", () => {
    const count = countAccounts();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("update non-existent account returns null", () => {
    const result = updateAccount("non-existent-id", { handle: "newhandle" });
    expect(result).toBeNull();
  });

  test("delete non-existent account returns false", () => {
    expect(deleteAccount("non-existent-id")).toBe(false);
  });
});

// ---- Posts ----

describe("Posts", () => {
  let accountId: string;

  test("setup: create account for posts", () => {
    const account = createAccount({ platform: "x", handle: "poster" });
    accountId = account.id;
  });

  test("create and get post", () => {
    const post = createPost({
      account_id: accountId,
      content: "Hello world! This is my first post.",
      media_urls: ["https://example.com/image.jpg"],
      tags: ["greeting", "first"],
    });

    expect(post.id).toBeTruthy();
    expect(post.account_id).toBe(accountId);
    expect(post.content).toBe("Hello world! This is my first post.");
    expect(post.media_urls).toEqual(["https://example.com/image.jpg"]);
    expect(post.status).toBe("draft");
    expect(post.tags).toEqual(["greeting", "first"]);

    const fetched = getPost(post.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(post.id);
  });

  test("list posts", () => {
    createPost({ account_id: accountId, content: "Second post" });
    const all = listPosts();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list posts by account", () => {
    const posts = listPosts({ account_id: accountId });
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts.every((p) => p.account_id === accountId)).toBe(true);
  });

  test("list posts by status", () => {
    const drafts = listPosts({ status: "draft" });
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    expect(drafts.every((p) => p.status === "draft")).toBe(true);
  });

  test("list posts by tag", () => {
    const tagged = listPosts({ tag: "greeting" });
    expect(tagged.length).toBeGreaterThanOrEqual(1);
  });

  test("search posts", () => {
    const results = listPosts({ search: "Hello world" });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("update post", () => {
    const post = createPost({ account_id: accountId, content: "Update me" });
    const updated = updatePost(post.id, {
      content: "Updated content",
      tags: ["updated"],
    });

    expect(updated).toBeDefined();
    expect(updated!.content).toBe("Updated content");
    expect(updated!.tags).toEqual(["updated"]);
  });

  test("schedule post", () => {
    const post = createPost({ account_id: accountId, content: "Schedule me" });
    const scheduled = schedulePost(post.id, "2026-04-01 10:00:00");

    expect(scheduled).toBeDefined();
    expect(scheduled!.status).toBe("scheduled");
    expect(scheduled!.scheduled_at).toBe("2026-04-01 10:00:00");
  });

  test("publish post", () => {
    const post = createPost({ account_id: accountId, content: "Publish me" });
    const published = publishPost(post.id, "platform-123");

    expect(published).toBeDefined();
    expect(published!.status).toBe("published");
    expect(published!.published_at).toBeTruthy();
    expect(published!.platform_post_id).toBe("platform-123");
  });

  test("update post engagement", () => {
    const post = createPost({ account_id: accountId, content: "Engage me" });
    publishPost(post.id);
    const updated = updatePost(post.id, {
      engagement: { likes: 100, shares: 20, comments: 5, impressions: 1000, clicks: 50 },
    });

    expect(updated).toBeDefined();
    expect(updated!.engagement.likes).toBe(100);
    expect(updated!.engagement.shares).toBe(20);
    expect(updated!.engagement.comments).toBe(5);
    expect(updated!.engagement.impressions).toBe(1000);
    expect(updated!.engagement.clicks).toBe(50);
  });

  test("delete post", () => {
    const post = createPost({ account_id: accountId, content: "Delete me" });
    expect(deletePost(post.id)).toBe(true);
    expect(getPost(post.id)).toBeNull();
  });

  test("count posts", () => {
    const count = countPosts();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("update non-existent post returns null", () => {
    const result = updatePost("non-existent-id", { content: "new" });
    expect(result).toBeNull();
  });

  test("delete non-existent post returns false", () => {
    expect(deletePost("non-existent-id")).toBe(false);
  });
});

// ---- Templates ----

describe("Templates", () => {
  let accountId: string;

  test("setup: create account for templates", () => {
    const account = createAccount({ platform: "linkedin", handle: "templater" });
    accountId = account.id;
  });

  test("create and get template", () => {
    const template = createTemplate({
      name: "Product Launch",
      content: "Excited to announce {{product}}! {{description}}",
      variables: ["product", "description"],
    });

    expect(template.id).toBeTruthy();
    expect(template.name).toBe("Product Launch");
    expect(template.content).toContain("{{product}}");
    expect(template.variables).toEqual(["product", "description"]);

    const fetched = getTemplate(template.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(template.id);
  });

  test("list templates", () => {
    createTemplate({ name: "Weekly Update", content: "This week: {{update}}" });
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(2);
  });

  test("use template to create post", () => {
    const template = createTemplate({
      name: "Announcement",
      content: "Big news: {{news}}! Learn more at {{url}}",
      variables: ["news", "url"],
    });

    const post = useTemplate(template.id, accountId, {
      news: "We launched v2.0",
      url: "https://example.com",
    }, ["announcement"]);

    expect(post.id).toBeTruthy();
    expect(post.content).toBe("Big news: We launched v2.0! Learn more at https://example.com");
    expect(post.account_id).toBe(accountId);
    expect(post.tags).toEqual(["announcement"]);
  });

  test("use non-existent template throws error", () => {
    expect(() => {
      useTemplate("non-existent", accountId, {});
    }).toThrow("Template 'non-existent' not found");
  });

  test("delete template", () => {
    const template = createTemplate({ name: "DeleteMe", content: "temp" });
    expect(deleteTemplate(template.id)).toBe(true);
    expect(getTemplate(template.id)).toBeNull();
  });

  test("delete non-existent template returns false", () => {
    expect(deleteTemplate("non-existent-id")).toBe(false);
  });
});

// ---- Analytics ----

describe("Analytics", () => {
  let accountId: string;

  test("setup: create account and published posts with engagement", () => {
    const account = createAccount({ platform: "x", handle: "analytics_test" });
    accountId = account.id;

    // Create and publish posts with engagement
    const post1 = createPost({ account_id: accountId, content: "Analytics post 1" });
    publishPost(post1.id);
    updatePost(post1.id, {
      engagement: { likes: 50, shares: 10, comments: 3, impressions: 500, clicks: 25 },
    });

    const post2 = createPost({ account_id: accountId, content: "Analytics post 2" });
    publishPost(post2.id);
    updatePost(post2.id, {
      engagement: { likes: 100, shares: 30, comments: 7, impressions: 1500, clicks: 75 },
    });
  });

  test("get engagement stats for account", () => {
    const stats = getEngagementStats(accountId);
    expect(stats.total_posts).toBe(2);
    expect(stats.total_likes).toBe(150);
    expect(stats.total_shares).toBe(40);
    expect(stats.total_comments).toBe(10);
    expect(stats.total_impressions).toBe(2000);
    expect(stats.total_clicks).toBe(100);
    expect(stats.avg_likes).toBe(75);
    expect(stats.avg_shares).toBe(20);
  });

  test("get engagement stats across all accounts", () => {
    const stats = getEngagementStats();
    expect(stats.total_posts).toBeGreaterThanOrEqual(2);
  });

  test("get stats by platform", () => {
    const stats = getStatsByPlatform();
    expect(stats.length).toBeGreaterThanOrEqual(1);

    const xStats = stats.find((s) => s.platform === "x");
    expect(xStats).toBeDefined();
    expect(xStats!.account_count).toBeGreaterThanOrEqual(1);
    expect(xStats!.post_count).toBeGreaterThanOrEqual(1);
  });

  test("get calendar", () => {
    // Create a scheduled post
    const post = createPost({ account_id: accountId, content: "Calendar test" });
    schedulePost(post.id, "2026-05-01 09:00:00");

    const calendar = getCalendar("2026-04-01", "2026-06-01");
    expect(Object.keys(calendar).length).toBeGreaterThanOrEqual(1);
    expect(calendar["2026-05-01"]).toBeDefined();
    expect(calendar["2026-05-01"].length).toBeGreaterThanOrEqual(1);
  });

  test("get calendar with no results", () => {
    const calendar = getCalendar("2020-01-01", "2020-01-02");
    expect(Object.keys(calendar).length).toBe(0);
  });

  test("get overall stats", () => {
    const stats = getOverallStats();
    expect(stats.total_accounts).toBeGreaterThanOrEqual(1);
    expect(stats.total_posts).toBeGreaterThanOrEqual(1);
    expect(stats.total_templates).toBeGreaterThanOrEqual(0);
    expect(stats.posts_by_status).toBeDefined();
    expect(stats.engagement).toBeDefined();
  });
});

// ---- Edge Cases ----

describe("Edge Cases", () => {
  test("account with metadata", () => {
    const account = createAccount({
      platform: "bluesky",
      handle: "meta.bsky.social",
      metadata: { bio: "Hello", followers: 1000 },
    });

    expect(account.metadata).toEqual({ bio: "Hello", followers: 1000 });
    const fetched = getAccount(account.id);
    expect(fetched!.metadata).toEqual({ bio: "Hello", followers: 1000 });
  });

  test("post with empty engagement defaults", () => {
    const account = createAccount({ platform: "threads", handle: "edgecase" });
    const post = createPost({ account_id: account.id, content: "No engagement yet" });

    expect(post.engagement).toEqual({});
    expect(post.media_urls).toEqual([]);
    expect(post.tags).toEqual([]);
  });

  test("template with no variables", () => {
    const template = createTemplate({
      name: "Static",
      content: "This is a static template with no variables.",
    });

    expect(template.variables).toEqual([]);
  });

  test("cascade delete: removing account removes its posts", () => {
    const account = createAccount({ platform: "instagram", handle: "cascade_test" });
    createPost({ account_id: account.id, content: "Will be deleted" });
    createPost({ account_id: account.id, content: "Also deleted" });

    const postsBefore = listPosts({ account_id: account.id });
    expect(postsBefore.length).toBe(2);

    deleteAccount(account.id);

    const postsAfter = listPosts({ account_id: account.id });
    expect(postsAfter.length).toBe(0);
  });

  test("engagement stats with no published posts returns zeros", () => {
    const account = createAccount({ platform: "bluesky", handle: "noposts" });
    const stats = getEngagementStats(account.id);

    expect(stats.total_posts).toBe(0);
    expect(stats.total_likes).toBe(0);
    expect(stats.avg_likes).toBe(0);
  });

  test("update account with no changes returns existing", () => {
    const account = createAccount({ platform: "x", handle: "nochange" });
    const result = updateAccount(account.id, {});
    expect(result).toBeDefined();
    expect(result!.id).toBe(account.id);
  });

  test("update post with no changes returns existing", () => {
    const account = createAccount({ platform: "x", handle: "nochangepost" });
    const post = createPost({ account_id: account.id, content: "No changes" });
    const result = updatePost(post.id, {});
    expect(result).toBeDefined();
    expect(result!.id).toBe(post.id);
  });
});

// ---- Platform Limits ----

describe("Platform Limits", () => {
  test("PLATFORM_LIMITS has all platforms", () => {
    expect(PLATFORM_LIMITS.x).toBe(280);
    expect(PLATFORM_LIMITS.linkedin).toBe(3000);
    expect(PLATFORM_LIMITS.instagram).toBe(2200);
    expect(PLATFORM_LIMITS.threads).toBe(500);
    expect(PLATFORM_LIMITS.bluesky).toBe(300);
  });

  test("checkPlatformLimit warns when over limit", () => {
    const account = createAccount({ platform: "x", handle: "charlimit" });
    const longContent = "a".repeat(300); // Over X's 280 limit
    const warning = checkPlatformLimit(longContent, account.id);

    expect(warning).not.toBeNull();
    expect(warning!.platform).toBe("x");
    expect(warning!.limit).toBe(280);
    expect(warning!.content_length).toBe(300);
    expect(warning!.over_by).toBe(20);
  });

  test("checkPlatformLimit returns null when within limit", () => {
    const account = createAccount({ platform: "linkedin", handle: "charlimit2" });
    const shortContent = "Hello world!";
    const warning = checkPlatformLimit(shortContent, account.id);
    expect(warning).toBeNull();
  });

  test("checkPlatformLimit returns null for non-existent account", () => {
    const warning = checkPlatformLimit("hello", "non-existent-id");
    expect(warning).toBeNull();
  });
});

// ---- Batch Schedule ----

describe("Batch Schedule", () => {
  let accountId: string;

  test("setup: create account for batch", () => {
    const account = createAccount({ platform: "x", handle: "batchposter" });
    accountId = account.id;
  });

  test("batch schedule multiple posts", () => {
    const result = batchSchedule([
      { account_id: accountId, content: "Batch post 1", scheduled_at: "2026-05-01 10:00:00" },
      { account_id: accountId, content: "Batch post 2", scheduled_at: "2026-05-01 14:00:00" },
      { account_id: accountId, content: "Batch post 3", scheduled_at: "2026-05-02 09:00:00" },
    ]);

    expect(result.scheduled.length).toBe(3);
    expect(result.errors.length).toBe(0);
    expect(result.scheduled[0].status).toBe("scheduled");
    expect(result.scheduled[0].scheduled_at).toBe("2026-05-01 10:00:00");
  });

  test("batch schedule with invalid account", () => {
    const result = batchSchedule([
      { account_id: "non-existent", content: "Will fail", scheduled_at: "2026-05-01 10:00:00" },
      { account_id: accountId, content: "Will succeed", scheduled_at: "2026-05-01 11:00:00" },
    ]);

    expect(result.scheduled.length).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].index).toBe(0);
    expect(result.errors[0].error).toContain("not found");
  });

  test("batch schedule with platform limit warning", () => {
    const result = batchSchedule([
      { account_id: accountId, content: "a".repeat(300), scheduled_at: "2026-06-01 10:00:00" },
    ]);

    expect(result.scheduled.length).toBe(1);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].platform).toBe("x");
    expect(result.warnings[0].over_by).toBe(20);
  });

  test("batch schedule with recurrence", () => {
    const result = batchSchedule([
      { account_id: accountId, content: "Recurring batch", scheduled_at: "2026-05-01 10:00:00", recurrence: "weekly" },
    ]);

    expect(result.scheduled.length).toBe(1);
    expect(result.scheduled[0].recurrence).toBe("weekly");
  });
});

// ---- Cross-Post ----

describe("Cross-Post", () => {
  test("setup: create accounts for cross-posting", () => {
    createAccount({ platform: "x", handle: "crossx" });
    createAccount({ platform: "linkedin", handle: "crosslinkedin" });
    createAccount({ platform: "bluesky", handle: "crossbsky.social" });
  });

  test("cross-post to multiple platforms", () => {
    const result = crossPost("Hello cross-post world!", ["x", "linkedin"]);

    expect(result.posts.length).toBe(2);
    expect(result.posts[0].content).toBe("Hello cross-post world!");
    expect(result.posts[1].content).toBe("Hello cross-post world!");
  });

  test("cross-post with scheduling", () => {
    const result = crossPost("Scheduled cross-post", ["x", "linkedin"], {
      scheduled_at: "2026-06-01 12:00:00",
      tags: ["crosspost"],
    });

    expect(result.posts.length).toBe(2);
    expect(result.posts[0].status).toBe("scheduled");
    expect(result.posts[0].scheduled_at).toBe("2026-06-01 12:00:00");
    expect(result.posts[0].tags).toEqual(["crosspost"]);
  });

  test("cross-post warns on platform limit", () => {
    const longContent = "a".repeat(350); // Over both X (280) and Bluesky (300)
    const result = crossPost(longContent, ["x", "bluesky"]);

    expect(result.posts.length).toBe(2);
    expect(result.warnings.length).toBe(2);
  });

  test("cross-post throws for platform with no accounts", () => {
    // Delete all threads accounts first to ensure none exist
    const threadsAccounts = listAccounts({ platform: "threads" });
    for (const a of threadsAccounts) {
      deleteAccount(a.id);
    }

    expect(() => {
      crossPost("Hello", ["threads"]);
    }).toThrow("No account found for platform 'threads'");

    // Re-create a threads account for other tests
    createAccount({ platform: "threads", handle: "restored_threads" });
  });
});

// ---- Best Time to Post ----

describe("Best Time to Post", () => {
  let accountId: string;

  test("setup: create account with published posts at various times", () => {
    const account = createAccount({ platform: "x", handle: "besttime" });
    accountId = account.id;

    // Create and publish posts at different times
    const post1 = createPost({ account_id: accountId, content: "Monday morning post" });
    publishPost(post1.id);
    // Manually set published_at to control the time
    updatePost(post1.id, {
      published_at: "2026-03-02 09:00:00", // Monday 9AM
      engagement: { likes: 100, shares: 20, comments: 10, impressions: 1000, clicks: 50 },
    });

    const post2 = createPost({ account_id: accountId, content: "Friday afternoon post" });
    publishPost(post2.id);
    updatePost(post2.id, {
      published_at: "2026-03-06 15:00:00", // Friday 3PM
      engagement: { likes: 200, shares: 50, comments: 25, impressions: 3000, clicks: 100 },
    });

    const post3 = createPost({ account_id: accountId, content: "Monday evening post" });
    publishPost(post3.id);
    updatePost(post3.id, {
      published_at: "2026-03-02 18:00:00", // Monday 6PM
      engagement: { likes: 50, shares: 5, comments: 2, impressions: 300, clicks: 10 },
    });
  });

  test("get best time to post", () => {
    const result = getBestTimeToPost(accountId);

    expect(result.total_analyzed).toBe(3);
    expect(result.best_hours.length).toBeGreaterThan(0);
    expect(result.best_days.length).toBeGreaterThan(0);

    // Friday should be the best day (highest engagement)
    expect(result.best_days[0].day_name).toBe("Friday");
  });

  test("best time to post with no data", () => {
    const account = createAccount({ platform: "x", handle: "nopublished" });
    const result = getBestTimeToPost(account.id);

    expect(result.total_analyzed).toBe(0);
    expect(result.best_hours.length).toBe(0);
    expect(result.best_days.length).toBe(0);
  });
});

// ---- Reschedule ----

describe("Reschedule", () => {
  let accountId: string;

  test("setup: create account for rescheduling", () => {
    const account = createAccount({ platform: "x", handle: "rescheduler" });
    accountId = account.id;
  });

  test("reschedule a scheduled post", () => {
    const post = createPost({ account_id: accountId, content: "Reschedule me" });
    schedulePost(post.id, "2026-05-01 10:00:00");

    const rescheduled = reschedulePost(post.id, "2026-05-02 14:00:00");
    expect(rescheduled).toBeDefined();
    expect(rescheduled!.scheduled_at).toBe("2026-05-02 14:00:00");
    expect(rescheduled!.status).toBe("scheduled");
  });

  test("reschedule a draft post", () => {
    const post = createPost({ account_id: accountId, content: "Draft reschedule" });

    const rescheduled = reschedulePost(post.id, "2026-06-01 12:00:00");
    expect(rescheduled).toBeDefined();
    expect(rescheduled!.scheduled_at).toBe("2026-06-01 12:00:00");
    expect(rescheduled!.status).toBe("scheduled");
  });

  test("reschedule published post throws error", () => {
    const post = createPost({ account_id: accountId, content: "Already published" });
    publishPost(post.id);

    expect(() => {
      reschedulePost(post.id, "2026-06-01 12:00:00");
    }).toThrow("Cannot reschedule post with status 'published'");
  });

  test("reschedule non-existent post returns null", () => {
    const result = reschedulePost("non-existent", "2026-06-01 12:00:00");
    expect(result).toBeNull();
  });
});

// ---- Approval Workflow ----

describe("Approval Workflow", () => {
  let accountId: string;

  test("setup: create account for approval", () => {
    const account = createAccount({ platform: "x", handle: "approver" });
    accountId = account.id;
  });

  test("submit draft for review", () => {
    const post = createPost({ account_id: accountId, content: "Review this" });
    expect(post.status).toBe("draft");

    const submitted = submitPostForReview(post.id);
    expect(submitted).toBeDefined();
    expect(submitted!.status).toBe("pending_review");
  });

  test("submit non-draft throws error", () => {
    const post = createPost({ account_id: accountId, content: "Already scheduled" });
    schedulePost(post.id, "2026-07-01 10:00:00");

    expect(() => {
      submitPostForReview(post.id);
    }).toThrow("Cannot submit post with status 'scheduled'");
  });

  test("approve pending_review post with date", () => {
    const post = createPost({ account_id: accountId, content: "Approve me" });
    submitPostForReview(post.id);

    const approved = approvePost(post.id, "2026-07-01 10:00:00");
    expect(approved).toBeDefined();
    expect(approved!.status).toBe("scheduled");
    expect(approved!.scheduled_at).toBe("2026-07-01 10:00:00");
  });

  test("approve pending_review post with existing scheduled_at", () => {
    const post = createPost({
      account_id: accountId,
      content: "Approve with existing date",
      scheduled_at: "2026-08-01 10:00:00",
    });
    submitPostForReview(post.id);

    const approved = approvePost(post.id);
    expect(approved).toBeDefined();
    expect(approved!.status).toBe("scheduled");
    expect(approved!.scheduled_at).toBe("2026-08-01 10:00:00");
  });

  test("approve post without date throws error", () => {
    const post = createPost({ account_id: accountId, content: "No date" });
    submitPostForReview(post.id);

    expect(() => {
      approvePost(post.id);
    }).toThrow("Cannot approve post without a scheduled date");
  });

  test("approve non-pending post throws error", () => {
    const post = createPost({ account_id: accountId, content: "Not pending" });

    expect(() => {
      approvePost(post.id, "2026-07-01 10:00:00");
    }).toThrow("Cannot approve post with status 'draft'");
  });

  test("submit non-existent post returns null", () => {
    const result = submitPostForReview("non-existent");
    expect(result).toBeNull();
  });

  test("approve non-existent post returns null", () => {
    const result = approvePost("non-existent", "2026-07-01 10:00:00");
    expect(result).toBeNull();
  });
});

// ---- Recurring Posts ----

describe("Recurring Posts", () => {
  let accountId: string;

  test("setup: create account for recurring", () => {
    const account = createAccount({ platform: "linkedin", handle: "recurring" });
    accountId = account.id;
  });

  test("create recurring weekly post", () => {
    const post = createRecurringPost({
      account_id: accountId,
      content: "Weekly update!",
      scheduled_at: "2026-05-01 09:00:00",
      recurrence: "weekly",
    });

    expect(post.id).toBeTruthy();
    expect(post.recurrence).toBe("weekly");
    expect(post.status).toBe("scheduled");
    expect(post.scheduled_at).toBe("2026-05-01 09:00:00");
  });

  test("create recurring daily post", () => {
    const post = createRecurringPost({
      account_id: accountId,
      content: "Daily tip!",
      scheduled_at: "2026-05-01 08:00:00",
      recurrence: "daily",
      tags: ["tips"],
    });

    expect(post.recurrence).toBe("daily");
    expect(post.tags).toEqual(["tips"]);
  });

  test("create recurring monthly post", () => {
    const post = createRecurringPost({
      account_id: accountId,
      content: "Monthly newsletter",
      scheduled_at: "2026-05-01 10:00:00",
      recurrence: "monthly",
    });

    expect(post.recurrence).toBe("monthly");
  });

  test("create recurring post without scheduled_at throws", () => {
    expect(() => {
      createRecurringPost({
        account_id: accountId,
        content: "No date",
        recurrence: "weekly",
      } as any);
    }).toThrow("Recurring posts must have a scheduled_at date");
  });

  test("recurrence persists on read", () => {
    const post = createRecurringPost({
      account_id: accountId,
      content: "Persist check",
      scheduled_at: "2026-05-01 10:00:00",
      recurrence: "biweekly",
    });

    const fetched = getPost(post.id);
    expect(fetched).toBeDefined();
    expect(fetched!.recurrence).toBe("biweekly");
  });

  test("update post recurrence", () => {
    const post = createPost({ account_id: accountId, content: "Change recurrence" });
    const updated = updatePost(post.id, { recurrence: "monthly" });
    expect(updated!.recurrence).toBe("monthly");

    const cleared = updatePost(post.id, { recurrence: null });
    expect(cleared!.recurrence).toBeNull();
  });
});

// ---- Hashtag Analytics ----

describe("Hashtag Analytics", () => {
  let accountId: string;

  test("setup: create account with hashtag posts", () => {
    const account = createAccount({ platform: "x", handle: "hashtagger" });
    accountId = account.id;

    // Post with #launch and #product
    const post1 = createPost({ account_id: accountId, content: "Excited about #launch of #product!" });
    publishPost(post1.id);
    updatePost(post1.id, {
      engagement: { likes: 100, shares: 30, comments: 10, impressions: 2000 },
    });

    // Another post with #launch
    const post2 = createPost({ account_id: accountId, content: "Big day for #launch! #excited" });
    publishPost(post2.id);
    updatePost(post2.id, {
      engagement: { likes: 200, shares: 50, comments: 20, impressions: 5000 },
    });

    // Post with #product only
    const post3 = createPost({ account_id: accountId, content: "#product update coming soon" });
    publishPost(post3.id);
    updatePost(post3.id, {
      engagement: { likes: 50, shares: 5, comments: 2, impressions: 500 },
    });
  });

  test("get hashtag stats", () => {
    const stats = getHashtagStats(accountId);

    expect(stats.length).toBeGreaterThanOrEqual(3);

    const launchStat = stats.find((s) => s.hashtag === "launch");
    expect(launchStat).toBeDefined();
    expect(launchStat!.post_count).toBe(2);
    expect(launchStat!.total_likes).toBe(300);
    expect(launchStat!.total_shares).toBe(80);

    const productStat = stats.find((s) => s.hashtag === "product");
    expect(productStat).toBeDefined();
    expect(productStat!.post_count).toBe(2);
  });

  test("hashtag stats sorted by avg engagement", () => {
    const stats = getHashtagStats(accountId);
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i - 1].avg_engagement).toBeGreaterThanOrEqual(stats[i].avg_engagement);
    }
  });

  test("hashtag stats with no published posts returns empty", () => {
    const account = createAccount({ platform: "x", handle: "nohashtags" });
    const stats = getHashtagStats(account.id);
    expect(stats).toEqual([]);
  });

  test("hashtag stats with posts but no hashtags returns empty", () => {
    const account = createAccount({ platform: "x", handle: "nohashtags2" });
    const post = createPost({ account_id: account.id, content: "No hashtags here" });
    publishPost(post.id);
    updatePost(post.id, { engagement: { likes: 10 } });

    const stats = getHashtagStats(account.id);
    expect(stats).toEqual([]);
  });
});
