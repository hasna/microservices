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
