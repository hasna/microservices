import { describe, test, expect, afterAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "social-mentions-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import { createAccount } from "../db/social";
import { closeDatabase } from "../db/database";
import {
  createMention,
  getMention,
  listMentions,
  markRead,
  markAllRead,
  getMentionStats,
  pollMentions,
  stopPolling,
  isPolling,
  type MentionType,
} from "./mentions";

let accountId: string;
let accountId2: string;

afterAll(() => {
  stopPolling();
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  stopPolling();
});

// ---- Setup ----

describe("setup", () => {
  test("create test accounts", () => {
    const account = createAccount({ platform: "x", handle: "testuser" });
    accountId = account.id;
    const account2 = createAccount({ platform: "instagram", handle: "testuser_ig" });
    accountId2 = account2.id;
  });
});

// ---- createMention ----

describe("createMention", () => {
  test("creates a mention with all fields", () => {
    const mention = createMention({
      account_id: accountId,
      platform: "x",
      author: "John Doe",
      author_handle: "johndoe",
      content: "Hey @testuser great post!",
      type: "mention",
      platform_post_id: "tweet-123",
      sentiment: "positive",
      created_at: "2026-03-20 10:00:00",
    });

    expect(mention.id).toBeTruthy();
    expect(mention.account_id).toBe(accountId);
    expect(mention.platform).toBe("x");
    expect(mention.author).toBe("John Doe");
    expect(mention.author_handle).toBe("johndoe");
    expect(mention.content).toBe("Hey @testuser great post!");
    expect(mention.type).toBe("mention");
    expect(mention.platform_post_id).toBe("tweet-123");
    expect(mention.sentiment).toBe("positive");
    expect(mention.read).toBe(false);
    expect(mention.created_at).toBe("2026-03-20 10:00:00");
    expect(mention.fetched_at).toBeTruthy();
  });

  test("creates a mention with minimal fields", () => {
    const mention = createMention({
      account_id: accountId,
      platform: "x",
    });

    expect(mention.id).toBeTruthy();
    expect(mention.account_id).toBe(accountId);
    expect(mention.platform).toBe("x");
    expect(mention.author).toBeNull();
    expect(mention.content).toBeNull();
    expect(mention.type).toBeNull();
    expect(mention.read).toBe(false);
  });

  test("creates mentions with different types", () => {
    const types: MentionType[] = ["mention", "reply", "quote", "dm"];
    for (const type of types) {
      const mention = createMention({
        account_id: accountId,
        platform: "x",
        type,
        content: `Test ${type}`,
      });
      expect(mention.type).toBe(type);
    }
  });
});

// ---- getMention ----

describe("getMention", () => {
  test("gets a mention by ID", () => {
    const created = createMention({
      account_id: accountId,
      platform: "x",
      content: "Findable mention",
    });

    const found = getMention(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.content).toBe("Findable mention");
  });

  test("returns null for non-existent ID", () => {
    const found = getMention("non-existent-id");
    expect(found).toBeNull();
  });
});

// ---- listMentions ----

describe("listMentions", () => {
  test("lists all mentions for an account", () => {
    const mentions = listMentions(accountId);
    expect(mentions.length).toBeGreaterThan(0);
    for (const m of mentions) {
      expect(m.account_id).toBe(accountId);
    }
  });

  test("lists all mentions without account filter", () => {
    // Create one for account2
    createMention({
      account_id: accountId2,
      platform: "instagram",
      content: "IG mention",
    });

    const all = listMentions();
    expect(all.length).toBeGreaterThan(0);
    const platforms = new Set(all.map((m) => m.platform));
    expect(platforms.size).toBeGreaterThanOrEqual(1);
  });

  test("filters by unread", () => {
    const m = createMention({
      account_id: accountId,
      platform: "x",
      content: "Unread test",
    });
    markRead(m.id);

    const unread = listMentions(accountId, { unread: true });
    const readMentions = listMentions(accountId, { unread: false });

    const unreadIds = unread.map((m) => m.id);
    const readIds = readMentions.map((m) => m.id);

    expect(unreadIds).not.toContain(m.id);
    expect(readIds).toContain(m.id);
  });

  test("filters by type", () => {
    createMention({
      account_id: accountId,
      platform: "x",
      type: "dm",
      content: "DM test",
    });

    const dms = listMentions(accountId, { type: "dm" });
    expect(dms.length).toBeGreaterThan(0);
    for (const m of dms) {
      expect(m.type).toBe("dm");
    }
  });

  test("respects limit", () => {
    const limited = listMentions(accountId, { limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
  });

  test("returns results ordered by fetched_at DESC", () => {
    const mentions = listMentions(accountId);
    for (let i = 1; i < mentions.length; i++) {
      expect(mentions[i - 1].fetched_at >= mentions[i].fetched_at).toBe(true);
    }
  });
});

// ---- markRead ----

describe("markRead", () => {
  test("marks a mention as read", () => {
    const m = createMention({
      account_id: accountId,
      platform: "x",
      content: "Mark me read",
    });
    expect(m.read).toBe(false);

    const updated = markRead(m.id);
    expect(updated).not.toBeNull();
    expect(updated!.read).toBe(true);
  });

  test("returns null for non-existent ID", () => {
    const result = markRead("non-existent");
    expect(result).toBeNull();
  });

  test("is idempotent — marking already-read mention stays read", () => {
    const m = createMention({
      account_id: accountId,
      platform: "x",
      content: "Already read",
    });
    markRead(m.id);
    const again = markRead(m.id);
    expect(again!.read).toBe(true);
  });
});

// ---- markAllRead ----

describe("markAllRead", () => {
  test("marks all unread mentions for an account as read", () => {
    // Create fresh unread mentions for account2
    createMention({ account_id: accountId2, platform: "instagram", content: "Unread 1" });
    createMention({ account_id: accountId2, platform: "instagram", content: "Unread 2" });

    const unreadBefore = listMentions(accountId2, { unread: true });
    expect(unreadBefore.length).toBeGreaterThanOrEqual(2);

    const count = markAllRead(accountId2);
    expect(count).toBeGreaterThanOrEqual(2);

    const unreadAfter = listMentions(accountId2, { unread: true });
    expect(unreadAfter.length).toBe(0);
  });

  test("returns 0 when no unread mentions exist", () => {
    // account2 was just marked all-read
    const count = markAllRead(accountId2);
    expect(count).toBe(0);
  });
});

// ---- getMentionStats ----

describe("getMentionStats", () => {
  test("returns correct stats", () => {
    // Create a fresh account with known data
    const account = createAccount({ platform: "x", handle: "stats_test" });
    const aid = account.id;

    createMention({ account_id: aid, platform: "x", type: "mention", sentiment: "positive", content: "A" });
    createMention({ account_id: aid, platform: "x", type: "mention", sentiment: "negative", content: "B" });
    createMention({ account_id: aid, platform: "x", type: "reply", sentiment: "positive", content: "C" });
    createMention({ account_id: aid, platform: "x", type: "dm", content: "D" }); // no sentiment

    // Mark one as read
    const mentions = listMentions(aid);
    markRead(mentions[0].id);

    const stats = getMentionStats(aid);
    expect(stats.total).toBe(4);
    expect(stats.unread).toBe(3);
    expect(stats.by_type["mention"]).toBe(2);
    expect(stats.by_type["reply"]).toBe(1);
    expect(stats.by_type["dm"]).toBe(1);
    expect(stats.by_sentiment["positive"]).toBe(2);
    expect(stats.by_sentiment["negative"]).toBe(1);
  });

  test("returns zeros for account with no mentions", () => {
    const account = createAccount({ platform: "x", handle: "empty_stats" });
    const stats = getMentionStats(account.id);
    expect(stats.total).toBe(0);
    expect(stats.unread).toBe(0);
    expect(Object.keys(stats.by_type).length).toBe(0);
    expect(Object.keys(stats.by_sentiment).length).toBe(0);
  });
});

// ---- pollMentions / stopPolling / isPolling ----

describe("Mention poller lifecycle", () => {
  test("starts and reports running", () => {
    pollMentions(60000);
    expect(isPolling()).toBe(true);
    stopPolling();
  });

  test("stops and reports not running", () => {
    pollMentions(60000);
    stopPolling();
    expect(isPolling()).toBe(false);
  });

  test("throws if started twice", () => {
    pollMentions(60000);
    expect(() => pollMentions(60000)).toThrow("already running");
    stopPolling();
  });

  test("stop is idempotent", () => {
    stopPolling();
    stopPolling(); // no throw
    expect(isPolling()).toBe(false);
  });
});
