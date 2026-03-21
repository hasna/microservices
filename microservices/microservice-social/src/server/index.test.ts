import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "social-server-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;
process.env["PORT"] = "0"; // Let Bun pick a random available port

import { createAccount, createPost, publishPost, type PostStatus } from "../db/social";
import { createMention } from "../lib/mentions";
import { closeDatabase } from "../db/database";

let baseUrl: string;
let server: ReturnType<typeof Bun.serve>;
let accountId: string;

beforeAll(async () => {
  // Dynamically import server after env is set
  const mod = await import("./index");
  server = mod.server;
  baseUrl = `http://localhost:${server.port}`;

  // Seed test data
  const account = createAccount({
    platform: "x",
    handle: "testuser",
    display_name: "Test User",
    connected: true,
  });
  accountId = account.id;

  createPost({ account_id: accountId, content: "Draft post", status: "draft" });
  createPost({ account_id: accountId, content: "Scheduled post", status: "scheduled", scheduled_at: "2026-04-01 10:00:00" });
  const pub = createPost({ account_id: accountId, content: "Published post", status: "draft" });
  publishPost(pub.id);

  createMention({
    account_id: accountId,
    platform: "x",
    author: "Someone",
    author_handle: "someone",
    content: "Hey @testuser great post!",
    type: "mention",
  });
});

afterAll(() => {
  server.stop(true);
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ---- Dashboard ----

describe("dashboard", () => {
  test("GET / returns HTML", async () => {
    const res = await fetch(baseUrl + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html");
    const html = await res.text();
    expect(html).toContain("Social Dashboard");
  });
});

// ---- Posts API ----

describe("GET /api/posts", () => {
  test("returns list of posts", async () => {
    const res = await fetch(baseUrl + "/api/posts");
    expect(res.status).toBe(200);
    const posts = await res.json();
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThanOrEqual(3);
  });

  test("filters by status", async () => {
    const res = await fetch(baseUrl + "/api/posts?status=draft");
    const posts = await res.json();
    expect(posts.length).toBeGreaterThanOrEqual(1);
    for (const p of posts) {
      expect(p.status).toBe("draft");
    }
  });

  test("supports search", async () => {
    const res = await fetch(baseUrl + "/api/posts?search=Scheduled");
    const posts = await res.json();
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts[0].content).toContain("Scheduled");
  });

  test("supports limit and offset", async () => {
    const res = await fetch(baseUrl + "/api/posts?limit=1&offset=0");
    const posts = await res.json();
    expect(posts.length).toBe(1);
  });
});

describe("GET /api/posts/:id", () => {
  test("returns a single post", async () => {
    const list = await (await fetch(baseUrl + "/api/posts?limit=1")).json();
    const id = list[0].id;
    const res = await fetch(baseUrl + "/api/posts/" + id);
    expect(res.status).toBe(200);
    const post = await res.json();
    expect(post.id).toBe(id);
  });

  test("returns 404 for missing post", async () => {
    const res = await fetch(baseUrl + "/api/posts/nonexistent-id");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/posts", () => {
  test("creates a post", async () => {
    const res = await fetch(baseUrl + "/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, content: "New API post", tags: ["test"] }),
    });
    expect(res.status).toBe(201);
    const post = await res.json();
    expect(post.content).toBe("New API post");
    expect(post.tags).toContain("test");
  });

  test("returns 422 for missing fields", async () => {
    const res = await fetch(baseUrl + "/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "No account" }),
    });
    expect(res.status).toBe(422);
  });
});

describe("PUT /api/posts/:id", () => {
  test("updates a post", async () => {
    const create = await (await fetch(baseUrl + "/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, content: "To update" }),
    })).json();

    const res = await fetch(baseUrl + "/api/posts/" + create.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Updated content" }),
    });
    expect(res.status).toBe(200);
    const post = await res.json();
    expect(post.content).toBe("Updated content");
  });

  test("returns 404 for missing post", async () => {
    const res = await fetch(baseUrl + "/api/posts/nonexistent-id", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/posts/:id", () => {
  test("deletes a post", async () => {
    const create = await (await fetch(baseUrl + "/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, content: "To delete" }),
    })).json();

    const res = await fetch(baseUrl + "/api/posts/" + create.id, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);

    // Verify it's gone
    const get = await fetch(baseUrl + "/api/posts/" + create.id);
    expect(get.status).toBe(404);
  });

  test("returns 404 for missing post", async () => {
    const res = await fetch(baseUrl + "/api/posts/nonexistent-id", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/posts/:id/publish", () => {
  test("publishes a post", async () => {
    const create = await (await fetch(baseUrl + "/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, content: "To publish" }),
    })).json();

    const res = await fetch(baseUrl + "/api/posts/" + create.id + "/publish", { method: "POST" });
    expect(res.status).toBe(200);
    const post = await res.json();
    expect(post.status).toBe("published");
    expect(post.published_at).toBeTruthy();
  });

  test("returns 404 for missing post", async () => {
    const res = await fetch(baseUrl + "/api/posts/nonexistent-id/publish", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

// ---- Accounts API ----

describe("GET /api/accounts", () => {
  test("returns list of accounts", async () => {
    const res = await fetch(baseUrl + "/api/accounts");
    expect(res.status).toBe(200);
    const accounts = await res.json();
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.length).toBeGreaterThanOrEqual(1);
    expect(accounts[0].handle).toBe("testuser");
  });
});

// ---- Calendar API ----

describe("GET /api/calendar", () => {
  test("returns calendar data", async () => {
    const res = await fetch(baseUrl + "/api/calendar");
    expect(res.status).toBe(200);
    const cal = await res.json();
    expect(typeof cal).toBe("object");
    // We have a scheduled post for 2026-04-01
    expect(cal["2026-04-01"]).toBeDefined();
    expect(cal["2026-04-01"].length).toBeGreaterThanOrEqual(1);
  });

  test("supports from/to params", async () => {
    const res = await fetch(baseUrl + "/api/calendar?from=2026-04-01&to=2026-04-30");
    expect(res.status).toBe(200);
    const cal = await res.json();
    expect(typeof cal).toBe("object");
  });
});

// ---- Analytics API ----

describe("GET /api/analytics", () => {
  test("returns overall stats", async () => {
    const res = await fetch(baseUrl + "/api/analytics");
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats.total_posts).toBeGreaterThanOrEqual(3);
    expect(stats.total_accounts).toBeGreaterThanOrEqual(1);
    expect(stats.engagement).toBeDefined();
    expect(stats.posts_by_status).toBeDefined();
  });
});

// ---- Mentions API ----

describe("GET /api/mentions", () => {
  test("returns list of mentions", async () => {
    const res = await fetch(baseUrl + "/api/mentions");
    expect(res.status).toBe(200);
    const mentions = await res.json();
    expect(Array.isArray(mentions)).toBe(true);
    expect(mentions.length).toBeGreaterThanOrEqual(1);
  });

  test("filters by account_id", async () => {
    const res = await fetch(baseUrl + "/api/mentions?account_id=" + accountId);
    const mentions = await res.json();
    expect(mentions.length).toBeGreaterThanOrEqual(1);
    for (const m of mentions) {
      expect(m.account_id).toBe(accountId);
    }
  });

  test("filters unread", async () => {
    const res = await fetch(baseUrl + "/api/mentions?unread=true");
    const mentions = await res.json();
    for (const m of mentions) {
      expect(m.read).toBe(false);
    }
  });
});

// ---- Stats API ----

describe("GET /api/stats", () => {
  test("returns engagement stats", async () => {
    const res = await fetch(baseUrl + "/api/stats");
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(typeof stats.total_posts).toBe("number");
    expect(typeof stats.total_likes).toBe("number");
  });
});

// ---- CORS ----

describe("CORS", () => {
  test("OPTIONS returns CORS headers", async () => {
    const res = await fetch(baseUrl + "/api/posts", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
  });
});
