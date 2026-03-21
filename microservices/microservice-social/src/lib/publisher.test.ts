import { describe, test, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-social-publisher-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  XPublisher,
  MetaPublisher,
  getPublisher,
  checkProviders,
  publishToApi,
  syncPostMetrics,
} from "./publisher";
import { createAccount, createPost, getPost, updatePost } from "../db/social";
import { closeDatabase } from "../db/database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// Helper: create an X account + draft post
function seedXPost(content = "Hello world") {
  const account = createAccount({ platform: "x", handle: "testuser", connected: true });
  const post = createPost({ account_id: account.id, content, status: "draft" });
  return { account, post };
}

function seedMetaPost(content = "Hello Facebook") {
  const account = createAccount({ platform: "x", handle: "metauser", connected: true });
  // We use platform "x" in the DB because Meta publisher is selected via account platform.
  // For these tests we'll create a facebook-type account to test Meta path.
  // Actually, let's do it properly:
  const metaAccount = createAccount({ platform: "instagram" as any, handle: "metapage", connected: true });
  const post = createPost({ account_id: metaAccount.id, content, status: "draft" });
  return { account: metaAccount, post };
}

// ---- XPublisher ----

describe("XPublisher", () => {
  test("publishPost sends POST /2/tweets and returns platform post ID", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: any, opts: any) => {
      expect(String(url)).toContain("/2/tweets");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.text).toBe("Test tweet");
      return new Response(JSON.stringify({ data: { id: "12345", text: "Test tweet" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    try {
      const pub = new XPublisher({ bearerToken: "test-token" });
      const result = await pub.publishPost("Test tweet");
      expect(result.platformPostId).toBe("12345");
      expect(result.url).toContain("12345");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("publishPost includes media_ids when provided", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: any, opts: any) => {
      const body = JSON.parse(opts.body);
      expect(body.media).toEqual({ media_ids: ["m1", "m2"] });
      return new Response(JSON.stringify({ data: { id: "99", text: "with media" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    try {
      const pub = new XPublisher({ bearerToken: "test-token" });
      const result = await pub.publishPost("with media", ["m1", "m2"]);
      expect(result.platformPostId).toBe("99");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("publishPost throws on API error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as any;

    try {
      const pub = new XPublisher({ bearerToken: "bad-token" });
      await expect(pub.publishPost("fail")).rejects.toThrow("X API error 401");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("deletePost sends DELETE /2/tweets/:id", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: any, opts: any) => {
      expect(String(url)).toContain("/2/tweets/12345");
      expect(opts.method).toBe("DELETE");
      return new Response(JSON.stringify({ data: { deleted: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    try {
      const pub = new XPublisher({ bearerToken: "test-token" });
      const deleted = await pub.deletePost("12345");
      expect(deleted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getPostMetrics fetches tweet with public_metrics", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: any) => {
      expect(String(url)).toContain("/2/tweets/12345");
      expect(String(url)).toContain("tweet.fields=public_metrics");
      return new Response(
        JSON.stringify({
          data: {
            public_metrics: {
              like_count: 10,
              retweet_count: 5,
              reply_count: 3,
              impression_count: 1000,
              bookmark_count: 2,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    try {
      const pub = new XPublisher({ bearerToken: "test-token" });
      const metrics = await pub.getPostMetrics("12345");
      expect(metrics.likes).toBe(10);
      expect(metrics.shares).toBe(5);
      expect(metrics.comments).toBe(3);
      expect(metrics.impressions).toBe(1000);
      expect(metrics.clicks).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws when no auth is configured", () => {
    const pub = new XPublisher({});
    expect(() => (pub as any).getAuthHeader()).toThrow("no valid auth token");
  });

  test("uses accessToken when bearerToken is absent", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: any, opts: any) => {
      expect(opts.headers.Authorization).toBe("Bearer my-access-token");
      return new Response(JSON.stringify({ data: { id: "77", text: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    try {
      const pub = new XPublisher({ accessToken: "my-access-token" });
      const result = await pub.publishPost("ok");
      expect(result.platformPostId).toBe("77");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---- MetaPublisher ----

describe("MetaPublisher", () => {
  test("publishPost sends POST to /{pageId}/feed", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: any, opts: any) => {
      expect(String(url)).toContain("/page123/feed");
      expect(String(url)).toContain("access_token=meta-token");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.message).toBe("Hello FB");
      return new Response(JSON.stringify({ id: "page123_post456" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    try {
      const pub = new MetaPublisher({ accessToken: "meta-token", pageId: "page123" });
      const result = await pub.publishPost("Hello FB");
      expect(result.platformPostId).toBe("page123_post456");
      expect(result.url).toContain("page123_post456");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("deletePost sends DELETE to /{platformPostId}", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: any, opts: any) => {
      expect(String(url)).toContain("/page123_post456");
      expect(opts.method).toBe("DELETE");
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    try {
      const pub = new MetaPublisher({ accessToken: "meta-token", pageId: "page123" });
      const deleted = await pub.deletePost("page123_post456");
      expect(deleted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getPostMetrics parses Meta insights response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          shares: { count: 7 },
          reactions: { summary: { total_count: 20 } },
          comments: { summary: { total_count: 4 } },
          insights: {
            data: [
              { name: "post_impressions", values: [{ value: 500 }] },
              { name: "post_clicks", values: [{ value: 30 }] },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    try {
      const pub = new MetaPublisher({ accessToken: "meta-token", pageId: "p1" });
      const metrics = await pub.getPostMetrics("post1");
      expect(metrics.likes).toBe(20);
      expect(metrics.shares).toBe(7);
      expect(metrics.comments).toBe(4);
      expect(metrics.impressions).toBe(500);
      expect(metrics.clicks).toBe(30);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws when accessToken is missing", () => {
    const pub = new MetaPublisher({ pageId: "page1" });
    expect(pub.publishPost("hi")).rejects.toThrow("META_ACCESS_TOKEN is required");
  });

  test("throws when pageId is missing", () => {
    const pub = new MetaPublisher({ accessToken: "tok" });
    expect(pub.publishPost("hi")).rejects.toThrow("META_PAGE_ID is required");
  });
});

// ---- getPublisher ----

describe("getPublisher", () => {
  test("returns XPublisher for 'x'", () => {
    // Set env so constructor doesn't throw
    const orig = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = "test";
    try {
      const pub = getPublisher("x");
      expect(pub).toBeInstanceOf(XPublisher);
    } finally {
      process.env.X_BEARER_TOKEN = orig;
    }
  });

  test("returns MetaPublisher for 'meta'", () => {
    const pub = getPublisher("meta");
    expect(pub).toBeInstanceOf(MetaPublisher);
  });

  test("returns MetaPublisher for 'facebook'", () => {
    const pub = getPublisher("facebook");
    expect(pub).toBeInstanceOf(MetaPublisher);
  });

  test("throws for unsupported platform", () => {
    expect(() => getPublisher("tiktok")).toThrow("Unsupported publishing platform");
  });
});

// ---- checkProviders ----

describe("checkProviders", () => {
  test("returns false when no env vars set", () => {
    const origBearer = process.env.X_BEARER_TOKEN;
    const origAccess = process.env.X_ACCESS_TOKEN;
    const origMeta = process.env.META_ACCESS_TOKEN;
    const origPage = process.env.META_PAGE_ID;

    delete process.env.X_BEARER_TOKEN;
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PAGE_ID;

    try {
      const providers = checkProviders();
      expect(providers.x).toBe(false);
      expect(providers.meta).toBe(false);
    } finally {
      if (origBearer) process.env.X_BEARER_TOKEN = origBearer;
      if (origAccess) process.env.X_ACCESS_TOKEN = origAccess;
      if (origMeta) process.env.META_ACCESS_TOKEN = origMeta;
      if (origPage) process.env.META_PAGE_ID = origPage;
    }
  });

  test("returns true for X when bearer token is set", () => {
    const orig = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = "test-bearer";
    try {
      const providers = checkProviders();
      expect(providers.x).toBe(true);
    } finally {
      if (orig) process.env.X_BEARER_TOKEN = orig;
      else delete process.env.X_BEARER_TOKEN;
    }
  });

  test("returns true for Meta when both token and page ID set", () => {
    const origT = process.env.META_ACCESS_TOKEN;
    const origP = process.env.META_PAGE_ID;
    process.env.META_ACCESS_TOKEN = "tok";
    process.env.META_PAGE_ID = "page1";
    try {
      const providers = checkProviders();
      expect(providers.meta).toBe(true);
    } finally {
      if (origT) process.env.META_ACCESS_TOKEN = origT; else delete process.env.META_ACCESS_TOKEN;
      if (origP) process.env.META_PAGE_ID = origP; else delete process.env.META_PAGE_ID;
    }
  });
});

// ---- publishToApi ----

describe("publishToApi", () => {
  test("publishes post via X API and updates DB", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ data: { id: "tw-999", text: "Hello world" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const origBearer = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = "test-bearer";

    try {
      const { post } = seedXPost("Hello world");
      const result = await publishToApi(post.id);
      expect(result.status).toBe("published");
      expect(result.platform_post_id).toBe("tw-999");
      expect(result.published_at).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
      if (origBearer) process.env.X_BEARER_TOKEN = origBearer;
      else delete process.env.X_BEARER_TOKEN;
    }
  });

  test("throws for non-existent post", async () => {
    await expect(publishToApi("nonexistent-id")).rejects.toThrow("not found");
  });

  test("throws for already-published post", async () => {
    const { post } = seedXPost("already published");
    updatePost(post.id, { status: "published", published_at: "2025-01-01 00:00:00" });
    await expect(publishToApi(post.id)).rejects.toThrow("already published");
  });

  test("marks post as failed on API error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response("Rate limited", { status: 429 });
    }) as any;

    const origBearer = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = "test-bearer";

    try {
      const { post } = seedXPost("will fail");
      await expect(publishToApi(post.id)).rejects.toThrow("X API error 429");
      const failed = getPost(post.id);
      expect(failed!.status).toBe("failed");
    } finally {
      globalThis.fetch = originalFetch;
      if (origBearer) process.env.X_BEARER_TOKEN = origBearer;
      else delete process.env.X_BEARER_TOKEN;
    }
  });
});

// ---- syncPostMetrics ----

describe("syncPostMetrics", () => {
  test("fetches metrics and updates engagement in DB", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          data: {
            public_metrics: {
              like_count: 42,
              retweet_count: 10,
              reply_count: 5,
              impression_count: 2000,
              bookmark_count: 3,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const origBearer = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = "test-bearer";

    try {
      const { post } = seedXPost("metrics test");
      // Mark as published with a platform_post_id
      updatePost(post.id, { status: "published", platform_post_id: "tw-metrics-1" });

      const updated = await syncPostMetrics(post.id);
      expect(updated.engagement.likes).toBe(42);
      expect(updated.engagement.shares).toBe(10);
      expect(updated.engagement.comments).toBe(5);
      expect(updated.engagement.impressions).toBe(2000);
    } finally {
      globalThis.fetch = originalFetch;
      if (origBearer) process.env.X_BEARER_TOKEN = origBearer;
      else delete process.env.X_BEARER_TOKEN;
    }
  });

  test("throws if post has no platform_post_id", async () => {
    const { post } = seedXPost("no platform id");
    updatePost(post.id, { status: "published" });
    await expect(syncPostMetrics(post.id)).rejects.toThrow("no platform_post_id");
  });
});
