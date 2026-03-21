import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "social-threads-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createAccount,
  getPost,
  getThreadPosts,
  deleteThreadPosts,
} from "../db/social";
import { closeDatabase } from "../db/database";
import {
  createThread,
  getThread,
  deleteThread,
  createCarousel,
} from "./threads";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// Helper to create an X account for testing
function createXAccount() {
  return createAccount({ platform: "x", handle: "testuser" });
}

function createInstagramAccount() {
  return createAccount({ platform: "instagram", handle: "instauser" });
}

function createLinkedInAccount() {
  return createAccount({ platform: "linkedin", handle: "linkedinuser" });
}

// ---- Thread creation ----

describe("createThread", () => {
  test("creates a thread with multiple posts linked by thread_id", () => {
    const account = createXAccount();
    const result = createThread(
      ["First tweet", "Second tweet", "Third tweet"],
      account.id
    );

    expect(result.threadId).toBeDefined();
    expect(result.posts).toHaveLength(3);
    expect(result.posts[0].thread_id).toBe(result.threadId);
    expect(result.posts[1].thread_id).toBe(result.threadId);
    expect(result.posts[2].thread_id).toBe(result.threadId);
    expect(result.posts[0].thread_position).toBe(0);
    expect(result.posts[1].thread_position).toBe(1);
    expect(result.posts[2].thread_position).toBe(2);
  });

  test("sets correct status for draft thread", () => {
    const account = createXAccount();
    const result = createThread(["Post 1", "Post 2"], account.id);

    for (const post of result.posts) {
      expect(post.status).toBe("draft");
    }
  });

  test("sets scheduled status when scheduledAt is provided", () => {
    const account = createXAccount();
    const result = createThread(["Post 1", "Post 2"], account.id, {
      scheduledAt: "2026-04-01 10:00:00",
    });

    for (const post of result.posts) {
      expect(post.status).toBe("scheduled");
      expect(post.scheduled_at).toBe("2026-04-01 10:00:00");
    }
  });

  test("applies tags to all posts in thread", () => {
    const account = createXAccount();
    const result = createThread(["Post 1", "Post 2"], account.id, {
      tags: ["thread", "test"],
    });

    for (const post of result.posts) {
      expect(post.tags).toEqual(["thread", "test"]);
    }
  });

  test("throws on empty contents array", () => {
    const account = createXAccount();
    expect(() => createThread([], account.id)).toThrow(
      "Thread must have at least one post."
    );
  });

  test("throws on invalid account ID", () => {
    expect(() =>
      createThread(["Hello"], "nonexistent-account-id")
    ).toThrow("Account 'nonexistent-account-id' not found.");
  });

  test("throws when a post exceeds platform character limit", () => {
    const account = createXAccount(); // X limit is 280
    const longContent = "a".repeat(281);
    expect(() =>
      createThread(["Short post", longContent], account.id)
    ).toThrow(/exceeds x limit/);
  });

  test("allows single-post thread", () => {
    const account = createXAccount();
    const result = createThread(["Only post"], account.id);

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].thread_position).toBe(0);
    expect(result.posts[0].thread_id).toBe(result.threadId);
  });
});

// ---- getThread ----

describe("getThread", () => {
  test("returns posts ordered by position", () => {
    const account = createXAccount();
    const { threadId } = createThread(
      ["Third-ish", "First-ish", "Second-ish"],
      account.id
    );

    const posts = getThread(threadId);
    expect(posts).toHaveLength(3);
    expect(posts[0].thread_position).toBe(0);
    expect(posts[1].thread_position).toBe(1);
    expect(posts[2].thread_position).toBe(2);
    expect(posts[0].content).toBe("Third-ish");
    expect(posts[1].content).toBe("First-ish");
    expect(posts[2].content).toBe("Second-ish");
  });

  test("throws on nonexistent thread ID", () => {
    expect(() => getThread("nonexistent-thread")).toThrow(
      "Thread 'nonexistent-thread' not found."
    );
  });
});

// ---- deleteThread ----

describe("deleteThread", () => {
  test("deletes all posts in a thread", () => {
    const account = createXAccount();
    const { threadId, posts } = createThread(
      ["Delete me 1", "Delete me 2"],
      account.id
    );

    expect(posts).toHaveLength(2);

    const deleted = deleteThread(threadId);
    expect(deleted).toBe(2);

    // Verify posts are gone
    const remaining = getThreadPosts(threadId);
    expect(remaining).toHaveLength(0);
  });

  test("throws on nonexistent thread", () => {
    expect(() => deleteThread("nonexistent-thread")).toThrow(
      "Thread 'nonexistent-thread' not found."
    );
  });
});

// ---- DB-level thread functions ----

describe("getThreadPosts and deleteThreadPosts", () => {
  test("getThreadPosts returns empty array for unknown thread_id", () => {
    const posts = getThreadPosts("no-such-thread");
    expect(posts).toHaveLength(0);
  });

  test("deleteThreadPosts returns 0 for unknown thread_id", () => {
    const count = deleteThreadPosts("no-such-thread");
    expect(count).toBe(0);
  });
});

// ---- Carousel ----

describe("createCarousel", () => {
  test("creates a post with multiple media_urls", () => {
    const account = createInstagramAccount();
    const post = createCarousel(
      ["img1.jpg", "img2.jpg", "img3.jpg"],
      ["First slide", "Second slide"],
      account.id
    );

    expect(post.media_urls).toEqual(["img1.jpg", "img2.jpg", "img3.jpg"]);
    expect(post.content).toBe("First slide\n\nSecond slide");
    expect(post.status).toBe("draft");
  });

  test("creates carousel with empty captions", () => {
    const account = createInstagramAccount();
    const post = createCarousel(
      ["img1.jpg", "img2.jpg"],
      [],
      account.id
    );

    expect(post.media_urls).toEqual(["img1.jpg", "img2.jpg"]);
    expect(post.content).toBe("");
  });

  test("throws on empty images array", () => {
    const account = createInstagramAccount();
    expect(() => createCarousel([], ["caption"], account.id)).toThrow(
      "Carousel must have at least one image."
    );
  });

  test("throws on invalid account ID", () => {
    expect(() =>
      createCarousel(["img.jpg"], [], "bad-account")
    ).toThrow("Account 'bad-account' not found.");
  });

  test("throws when caption exceeds platform limit", () => {
    const account = createXAccount(); // X limit 280
    const longCaption = "a".repeat(281);
    expect(() =>
      createCarousel(["img.jpg"], [longCaption], account.id)
    ).toThrow(/exceeds x limit/);
  });

  test("works with LinkedIn account", () => {
    const account = createLinkedInAccount();
    const post = createCarousel(
      ["slide1.png", "slide2.png"],
      ["Professional carousel"],
      account.id
    );

    expect(post.media_urls).toHaveLength(2);
    expect(post.content).toBe("Professional carousel");
  });
});

// ---- Post thread fields persisted correctly ----

describe("thread fields in posts", () => {
  test("thread_id and thread_position are persisted and retrievable", () => {
    const account = createXAccount();
    const { posts } = createThread(["A", "B"], account.id);

    const retrieved = getPost(posts[0].id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.thread_id).toBe(posts[0].thread_id);
    expect(retrieved!.thread_position).toBe(0);

    const retrieved2 = getPost(posts[1].id);
    expect(retrieved2!.thread_position).toBe(1);
  });
});
