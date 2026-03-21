import { describe, test, expect, afterAll, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "social-metrics-sync-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createAccount,
  createPost,
  getPost,
  updatePost,
  getAccount,
  listPosts,
  type Post,
} from "../db/social";
import { getDatabase, closeDatabase } from "../db/database";
import {
  getRecentPublishedPosts,
  syncAllMetrics,
  syncAccountMetrics,
  startMetricsSync,
  stopMetricsSync,
  getMetricsSyncStatus,
  getSyncReport,
  resetMetricsSyncStatus,
} from "./metrics-sync";

afterAll(() => {
  stopMetricsSync();
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  stopMetricsSync();
  resetMetricsSyncStatus();
});

// ---- Helper: create a published post with platform_post_id ----

function createPublishedPost(accountId: string, content: string, daysAgo: number = 1): Post {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const publishedAt = date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  const post = createPost({
    account_id: accountId,
    content,
    status: "published",
  });

  updatePost(post.id, {
    published_at: publishedAt,
    platform_post_id: `platform_${post.id.substring(0, 8)}`,
    status: "published",
  });

  return getPost(post.id)!;
}

// ---- Migration: last_metrics_sync column ----

describe("last_metrics_sync migration", () => {
  test("posts table has last_metrics_sync column", () => {
    const db = getDatabase();
    const info = db.prepare("PRAGMA table_info(posts)").all() as Array<{ name: string }>;
    const columns = info.map((col) => col.name);
    expect(columns).toContain("last_metrics_sync");
  });
});

// ---- getRecentPublishedPosts ----

describe("getRecentPublishedPosts", () => {
  let accountId: string;

  test("setup: create account", () => {
    const account = createAccount({ platform: "x", handle: "metrics_test" });
    accountId = account.id;
  });

  test("returns published posts from last 7 days with platform_post_id", () => {
    const recent = createPublishedPost(accountId, "Recent published post", 3);
    const posts = getRecentPublishedPosts(7);
    const ids = posts.map((p) => p.id);
    expect(ids).toContain(recent.id);
  });

  test("excludes posts older than the cutoff", () => {
    const old = createPublishedPost(accountId, "Old published post", 10);
    const posts = getRecentPublishedPosts(7);
    const ids = posts.map((p) => p.id);
    expect(ids).not.toContain(old.id);
  });

  test("excludes draft posts", () => {
    const draft = createPost({
      account_id: accountId,
      content: "Draft post",
      status: "draft",
    });
    const posts = getRecentPublishedPosts(7);
    const ids = posts.map((p) => p.id);
    expect(ids).not.toContain(draft.id);
  });

  test("excludes published posts without platform_post_id", () => {
    const post = createPost({
      account_id: accountId,
      content: "No platform id",
      status: "published",
    });
    const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    updatePost(post.id, { published_at: now });

    const posts = getRecentPublishedPosts(7);
    const ids = posts.map((p) => p.id);
    expect(ids).not.toContain(post.id);
  });
});

// ---- syncAllMetrics ----

describe("syncAllMetrics", () => {
  let accountId: string;

  test("setup: create account for sync tests", () => {
    // Use a platform that doesn't have a publisher (linkedin) so syncPostMetrics throws
    const account = createAccount({ platform: "linkedin", handle: "sync_all_test" });
    accountId = account.id;
  });

  test("returns report with error counts when publisher unavailable", async () => {
    createPublishedPost(accountId, "Sync test post 1", 1);
    createPublishedPost(accountId, "Sync test post 2", 2);

    const report = await syncAllMetrics();
    // These will fail because linkedin publisher is not supported
    expect(report).toHaveProperty("posts_synced");
    expect(report).toHaveProperty("accounts_synced");
    expect(report).toHaveProperty("last_sync");
    expect(report).toHaveProperty("errors");
    expect(report.last_sync).toBeTruthy();
    // Since linkedin is unsupported, we expect errors
    expect(report.errors.length).toBeGreaterThan(0);
  });

  test("report errors have correct structure", async () => {
    const report = await syncAllMetrics();
    if (report.errors.length > 0) {
      const err = report.errors[0];
      expect(err).toHaveProperty("type");
      expect(err).toHaveProperty("id");
      expect(err).toHaveProperty("message");
      expect(err).toHaveProperty("timestamp");
      expect(err.type).toBe("post");
    }
  });
});

// ---- syncAccountMetrics ----

describe("syncAccountMetrics", () => {
  test("returns null for non-existent account", async () => {
    const result = await syncAccountMetrics("non-existent-id");
    expect(result).toBeNull();
  });

  test("updates account metadata with sync info on unsupported platform", async () => {
    // bluesky is unsupported, so getPublisher will throw
    const account = createAccount({ platform: "bluesky", handle: "account_sync_test" });
    const result = await syncAccountMetrics(account.id);

    expect(result).not.toBeNull();
    // Should have error metadata since bluesky publisher is unsupported
    expect(result!.metadata).toHaveProperty("last_metrics_sync_error");
    expect(result!.metadata).toHaveProperty("last_metrics_sync_attempt");
  });

  test("updates account metadata with sync timestamp on supported platform", async () => {
    // x is supported but will fail at API call level; the getPublisher call succeeds
    // but getPostMetrics (used by syncAccountMetrics) doesn't call it, so metadata gets updated
    const account = createAccount({
      platform: "x",
      handle: "x_sync_test",
    });
    // x publisher requires auth, so this will error — metadata should still be updated
    const result = await syncAccountMetrics(account.id);
    expect(result).not.toBeNull();
    // Either success metadata or error metadata should be present
    const meta = result!.metadata;
    const hasSync = "last_metrics_sync" in meta || "last_metrics_sync_error" in meta;
    expect(hasSync).toBe(true);
  });
});

// ---- startMetricsSync / stopMetricsSync / getMetricsSyncStatus ----

describe("Metrics sync lifecycle", () => {
  test("starts and reports running", () => {
    startMetricsSync(300000);
    const status = getMetricsSyncStatus();
    expect(status.running).toBe(true);
    expect(status.interval_ms).toBe(300000);
    stopMetricsSync();
  });

  test("stops and reports not running", () => {
    startMetricsSync(300000);
    stopMetricsSync();
    const status = getMetricsSyncStatus();
    expect(status.running).toBe(false);
  });

  test("throws if started twice", () => {
    startMetricsSync(300000);
    expect(() => startMetricsSync(300000)).toThrow("already running");
    stopMetricsSync();
  });

  test("stop is idempotent", () => {
    stopMetricsSync();
    stopMetricsSync(); // no throw
    expect(getMetricsSyncStatus().running).toBe(false);
  });

  test("uses custom interval", () => {
    startMetricsSync(60000);
    const status = getMetricsSyncStatus();
    expect(status.interval_ms).toBe(60000);
    stopMetricsSync();
  });

  test("uses default interval", () => {
    startMetricsSync();
    const status = getMetricsSyncStatus();
    expect(status.interval_ms).toBe(300000);
    stopMetricsSync();
  });
});

// ---- getSyncReport ----

describe("getSyncReport", () => {
  test("returns initial empty report", () => {
    const report = getSyncReport();
    expect(report.posts_synced).toBe(0);
    expect(report.accounts_synced).toBe(0);
    expect(report.last_sync).toBeNull();
    expect(report.errors).toEqual([]);
  });

  test("accumulates data after sync", async () => {
    const account = createAccount({ platform: "instagram", handle: "report_test" });
    createPublishedPost(account.id, "Report test post", 1);

    await syncAllMetrics();
    const report = getSyncReport();
    expect(report.last_sync).toBeTruthy();
    // instagram is unsupported, so errors accumulate
    expect(report.errors.length).toBeGreaterThan(0);
  });
});

// ---- resetMetricsSyncStatus ----

describe("resetMetricsSyncStatus", () => {
  test("resets counters to zero", async () => {
    const account = createAccount({ platform: "threads", handle: "reset_test" });
    createPublishedPost(account.id, "Reset test post", 1);
    await syncAllMetrics();

    resetMetricsSyncStatus();
    const status = getMetricsSyncStatus();
    expect(status.posts_synced).toBe(0);
    expect(status.accounts_synced).toBe(0);
    expect(status.errors).toBe(0);
    expect(status.last_sync).toBeNull();
  });
});
