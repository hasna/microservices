import { describe, test, expect, afterAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "social-scheduler-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createAccount,
  createPost,
  getPost,
  schedulePost,
  publishPost,
  listPosts,
} from "../db/social";
import { closeDatabase } from "../db/database";
import {
  getDuePosts,
  processScheduledPost,
  handleRecurrence,
  computeNextDate,
  runOnce,
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  resetSchedulerStatus,
} from "./scheduler";

afterAll(() => {
  stopScheduler();
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  stopScheduler();
  resetSchedulerStatus();
});

// ---- computeNextDate ----

describe("computeNextDate", () => {
  test("daily recurrence adds 1 day", () => {
    const next = computeNextDate("2026-05-01 10:00:00", "daily");
    expect(next).toBe("2026-05-02 10:00:00");
  });

  test("weekly recurrence adds 7 days", () => {
    const next = computeNextDate("2026-05-01 10:00:00", "weekly");
    expect(next).toBe("2026-05-08 10:00:00");
  });

  test("biweekly recurrence adds 14 days", () => {
    const next = computeNextDate("2026-05-01 10:00:00", "biweekly");
    expect(next).toBe("2026-05-15 10:00:00");
  });

  test("monthly recurrence adds 1 month", () => {
    const next = computeNextDate("2026-05-01 10:00:00", "monthly");
    expect(next).toBe("2026-06-01 10:00:00");
  });

  test("monthly recurrence handles year boundary", () => {
    const next = computeNextDate("2026-12-15 09:00:00", "monthly");
    expect(next).toBe("2027-01-15 09:00:00");
  });
});

// ---- getDuePosts ----

describe("getDuePosts", () => {
  let accountId: string;

  test("setup: create account", () => {
    const account = createAccount({ platform: "x", handle: "scheduler_test" });
    accountId = account.id;
  });

  test("finds posts where scheduled_at <= now", () => {
    // Past scheduled post — should be found
    const past = createPost({
      account_id: accountId,
      content: "Past due post",
      status: "scheduled",
      scheduled_at: "2020-01-01 10:00:00",
    });

    // Future scheduled post — should NOT be found
    const future = createPost({
      account_id: accountId,
      content: "Future post",
      status: "scheduled",
      scheduled_at: "2099-12-31 23:59:59",
    });

    const due = getDuePosts(new Date("2026-03-21T12:00:00Z"));
    const dueIds = due.map((p) => p.id);

    expect(dueIds).toContain(past.id);
    expect(dueIds).not.toContain(future.id);
  });

  test("ignores non-scheduled posts", () => {
    const draft = createPost({
      account_id: accountId,
      content: "Draft post with date",
      status: "draft",
      scheduled_at: "2020-01-01 10:00:00",
    });

    const due = getDuePosts(new Date("2026-03-21T12:00:00Z"));
    const dueIds = due.map((p) => p.id);
    expect(dueIds).not.toContain(draft.id);
  });

  test("ignores scheduled posts without scheduled_at", () => {
    // This is an edge case — scheduled status but no date
    const post = createPost({
      account_id: accountId,
      content: "No date scheduled",
      status: "scheduled",
    });

    const due = getDuePosts(new Date("2026-03-21T12:00:00Z"));
    const dueIds = due.map((p) => p.id);
    expect(dueIds).not.toContain(post.id);
  });
});

// ---- processScheduledPost ----

describe("processScheduledPost", () => {
  let accountId: string;

  test("setup: create account", () => {
    const account = createAccount({ platform: "linkedin", handle: "proc_test" });
    accountId = account.id;
  });

  test("publishes a scheduled post", () => {
    const post = createPost({
      account_id: accountId,
      content: "Process me",
      status: "scheduled",
      scheduled_at: "2020-01-01 10:00:00",
    });

    const result = processScheduledPost(post.id);
    expect(result.published).toBe(true);
    expect(result.postId).toBe(post.id);

    const updated = getPost(post.id);
    expect(updated!.status).toBe("published");
    expect(updated!.published_at).toBeTruthy();
  });

  test("returns error for non-existent post", () => {
    const result = processScheduledPost("non-existent-id");
    expect(result.published).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("returns error for non-scheduled post", () => {
    const post = createPost({
      account_id: accountId,
      content: "Draft post",
      status: "draft",
    });

    const result = processScheduledPost(post.id);
    expect(result.published).toBe(false);
    expect(result.error).toContain("expected 'scheduled'");
  });

  test("creates next post for recurring post", () => {
    const post = createPost({
      account_id: accountId,
      content: "Weekly recurring",
      status: "scheduled",
      scheduled_at: "2026-05-01 10:00:00",
      recurrence: "weekly",
    });

    const result = processScheduledPost(post.id);
    expect(result.published).toBe(true);
    expect(result.nextPostId).toBeTruthy();

    // Verify next post was created
    const nextPost = getPost(result.nextPostId!);
    expect(nextPost).toBeDefined();
    expect(nextPost!.content).toBe("Weekly recurring");
    expect(nextPost!.status).toBe("scheduled");
    expect(nextPost!.scheduled_at).toBe("2026-05-08 10:00:00");
    expect(nextPost!.recurrence).toBe("weekly");
  });
});

// ---- handleRecurrence ----

describe("handleRecurrence", () => {
  let accountId: string;

  test("setup: create account", () => {
    const account = createAccount({ platform: "x", handle: "recur_test" });
    accountId = account.id;
  });

  test("creates next daily post", () => {
    const post = createPost({
      account_id: accountId,
      content: "Daily post",
      status: "scheduled",
      scheduled_at: "2026-05-01 08:00:00",
      recurrence: "daily",
      tags: ["daily"],
    });

    const next = handleRecurrence(post.id);
    expect(next).not.toBeNull();
    expect(next!.scheduled_at).toBe("2026-05-02 08:00:00");
    expect(next!.recurrence).toBe("daily");
    expect(next!.tags).toEqual(["daily"]);
  });

  test("returns null for non-recurring post", () => {
    const post = createPost({
      account_id: accountId,
      content: "One-off",
      status: "scheduled",
      scheduled_at: "2026-05-01 10:00:00",
    });

    const next = handleRecurrence(post.id);
    expect(next).toBeNull();
  });

  test("returns null for non-existent post", () => {
    const next = handleRecurrence("non-existent");
    expect(next).toBeNull();
  });
});

// ---- runOnce ----

describe("runOnce", () => {
  let accountId: string;

  test("setup: create account", () => {
    const account = createAccount({ platform: "x", handle: "runonce_test" });
    accountId = account.id;
  });

  test("processes all due posts in one cycle", () => {
    const post1 = createPost({
      account_id: accountId,
      content: "Due post 1",
      status: "scheduled",
      scheduled_at: "2020-01-01 10:00:00",
    });
    const post2 = createPost({
      account_id: accountId,
      content: "Due post 2",
      status: "scheduled",
      scheduled_at: "2020-06-15 14:00:00",
    });

    resetSchedulerStatus();
    const results = runOnce(new Date("2026-03-21T12:00:00Z"));

    const publishedIds = results.filter((r) => r.published).map((r) => r.postId);
    expect(publishedIds).toContain(post1.id);
    expect(publishedIds).toContain(post2.id);

    const status = getSchedulerStatus();
    expect(status.postsProcessed).toBeGreaterThanOrEqual(2);
    expect(status.lastCheck).toBeTruthy();
  });
});

// ---- startScheduler / stopScheduler / getSchedulerStatus ----

describe("Scheduler lifecycle", () => {
  test("starts and reports running", () => {
    startScheduler(60000);
    const status = getSchedulerStatus();
    expect(status.running).toBe(true);
    expect(status.lastCheck).toBeTruthy();
    stopScheduler();
  });

  test("stops and reports not running", () => {
    startScheduler(60000);
    stopScheduler();
    const status = getSchedulerStatus();
    expect(status.running).toBe(false);
  });

  test("throws if started twice", () => {
    startScheduler(60000);
    expect(() => startScheduler(60000)).toThrow("already running");
    stopScheduler();
  });

  test("stop is idempotent", () => {
    stopScheduler();
    stopScheduler(); // no throw
    expect(getSchedulerStatus().running).toBe(false);
  });
});
