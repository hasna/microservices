import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "social-audience-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import { createAccount } from "../db/social";
import { closeDatabase, getDatabase } from "../db/database";
import {
  createFollower,
  getFollower,
  listFollowers,
  updateFollower,
  removeFollower,
  syncFollowers,
  createSnapshot,
  trackGrowth,
  getAudienceInsights,
  getFollowerGrowthChart,
  getTopFollowers,
} from "./audience";

let accountId: string;
let accountId2: string;

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
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

// ---- createFollower ----

describe("createFollower", () => {
  test("creates a follower with all fields", () => {
    const follower = createFollower({
      account_id: accountId,
      platform_user_id: "user-123",
      username: "alice",
      display_name: "Alice Wonderland",
      follower_count: 5000,
      following: true,
      followed_at: "2025-01-15 10:00:00",
      metadata: { bio: "test" },
    });

    expect(follower.id).toBeTruthy();
    expect(follower.account_id).toBe(accountId);
    expect(follower.platform_user_id).toBe("user-123");
    expect(follower.username).toBe("alice");
    expect(follower.display_name).toBe("Alice Wonderland");
    expect(follower.follower_count).toBe(5000);
    expect(follower.following).toBe(true);
    expect(follower.followed_at).toBe("2025-01-15 10:00:00");
    expect(follower.metadata).toEqual({ bio: "test" });
    expect(follower.created_at).toBeTruthy();
  });

  test("creates a follower with minimal fields", () => {
    const follower = createFollower({
      account_id: accountId,
      username: "bob",
    });

    expect(follower.id).toBeTruthy();
    expect(follower.account_id).toBe(accountId);
    expect(follower.username).toBe("bob");
    expect(follower.follower_count).toBe(0);
    expect(follower.following).toBe(true);
    expect(follower.metadata).toEqual({});
  });

  test("creates a follower with following=false", () => {
    const follower = createFollower({
      account_id: accountId,
      username: "charlie_unfollowed",
      following: false,
      unfollowed_at: "2025-03-01 12:00:00",
    });

    // The unfollowed_at is set via metadata or direct insert; following should be false
    expect(follower.following).toBe(false);
  });
});

// ---- getFollower ----

describe("getFollower", () => {
  test("returns follower by id", () => {
    const created = createFollower({
      account_id: accountId,
      username: "diana",
      follower_count: 1200,
    });
    const found = getFollower(created.id);
    expect(found).not.toBeNull();
    expect(found!.username).toBe("diana");
    expect(found!.follower_count).toBe(1200);
  });

  test("returns null for non-existent id", () => {
    const found = getFollower("non-existent-id");
    expect(found).toBeNull();
  });
});

// ---- listFollowers ----

describe("listFollowers", () => {
  test("lists all followers for an account", () => {
    const followers = listFollowers(accountId);
    expect(followers.length).toBeGreaterThanOrEqual(3);
  });

  test("filters by following=true", () => {
    const followers = listFollowers(accountId, { following: true });
    for (const f of followers) {
      expect(f.following).toBe(true);
    }
  });

  test("filters by following=false", () => {
    const followers = listFollowers(accountId, { following: false });
    for (const f of followers) {
      expect(f.following).toBe(false);
    }
  });

  test("filters by search (username)", () => {
    const followers = listFollowers(accountId, { search: "alice" });
    expect(followers.length).toBeGreaterThanOrEqual(1);
    expect(followers[0].username).toBe("alice");
  });

  test("limits results", () => {
    const followers = listFollowers(accountId, { limit: 2 });
    expect(followers.length).toBeLessThanOrEqual(2);
  });

  test("returns empty for account with no followers", () => {
    const followers = listFollowers(accountId2);
    expect(followers.length).toBe(0);
  });

  test("sorts by follower_count descending", () => {
    const followers = listFollowers(accountId, { following: true });
    for (let i = 1; i < followers.length; i++) {
      expect(followers[i - 1].follower_count).toBeGreaterThanOrEqual(followers[i].follower_count);
    }
  });
});

// ---- updateFollower ----

describe("updateFollower", () => {
  test("updates follower fields", () => {
    const created = createFollower({
      account_id: accountId,
      username: "eve",
      follower_count: 100,
    });

    const updated = updateFollower(created.id, {
      display_name: "Eve Updated",
      follower_count: 200,
    });

    expect(updated).not.toBeNull();
    expect(updated!.display_name).toBe("Eve Updated");
    expect(updated!.follower_count).toBe(200);
    expect(updated!.username).toBe("eve"); // unchanged
  });

  test("marks follower as unfollowed", () => {
    const created = createFollower({
      account_id: accountId,
      username: "frank",
    });

    const updated = updateFollower(created.id, {
      following: false,
      unfollowed_at: "2025-03-20 15:00:00",
    });

    expect(updated!.following).toBe(false);
    expect(updated!.unfollowed_at).toBe("2025-03-20 15:00:00");
  });

  test("returns null for non-existent follower", () => {
    const result = updateFollower("non-existent-id", { follower_count: 999 });
    expect(result).toBeNull();
  });

  test("returns existing when no fields to update", () => {
    const created = createFollower({
      account_id: accountId,
      username: "grace",
    });
    const result = updateFollower(created.id, {});
    expect(result).not.toBeNull();
    expect(result!.username).toBe("grace");
  });
});

// ---- removeFollower ----

describe("removeFollower", () => {
  test("removes a follower", () => {
    const created = createFollower({
      account_id: accountId,
      username: "to_remove",
    });

    const removed = removeFollower(created.id);
    expect(removed).toBe(true);

    const found = getFollower(created.id);
    expect(found).toBeNull();
  });

  test("returns false for non-existent follower", () => {
    const removed = removeFollower("non-existent-id");
    expect(removed).toBe(false);
  });
});

// ---- syncFollowers ----

describe("syncFollowers", () => {
  test("returns a sync result stub", () => {
    const result = syncFollowers(accountId);
    expect(result).toHaveProperty("synced");
    expect(result).toHaveProperty("new_followers");
    expect(result).toHaveProperty("unfollowed");
    expect(result).toHaveProperty("message");
    expect(result.message).toContain("stub");
  });
});

// ---- createSnapshot ----

describe("createSnapshot", () => {
  test("creates an audience snapshot", () => {
    const snapshot = createSnapshot(accountId, 1500, 200);
    expect(snapshot.id).toBeTruthy();
    expect(snapshot.account_id).toBe(accountId);
    expect(snapshot.follower_count).toBe(1500);
    expect(snapshot.following_count).toBe(200);
    expect(snapshot.snapshot_at).toBeTruthy();
  });
});

// ---- trackGrowth ----

describe("trackGrowth", () => {
  test("creates a snapshot from current follower counts", () => {
    const snapshot = trackGrowth(accountId);
    expect(snapshot.id).toBeTruthy();
    expect(snapshot.account_id).toBe(accountId);
    expect(snapshot.follower_count).toBeGreaterThanOrEqual(0);
    expect(snapshot.following_count).toBeGreaterThanOrEqual(0);
  });
});

// ---- getAudienceInsights ----

describe("getAudienceInsights", () => {
  test("returns insights for an account", () => {
    const insights = getAudienceInsights(accountId);
    expect(insights).toHaveProperty("total_followers");
    expect(insights).toHaveProperty("growth_rate_7d");
    expect(insights).toHaveProperty("growth_rate_30d");
    expect(insights).toHaveProperty("new_followers_7d");
    expect(insights).toHaveProperty("lost_followers_7d");
    expect(insights).toHaveProperty("top_followers");
    expect(Array.isArray(insights.top_followers)).toBe(true);
    expect(insights.total_followers).toBeGreaterThanOrEqual(0);
  });

  test("returns zero insights for account with no followers", () => {
    const insights = getAudienceInsights(accountId2);
    expect(insights.total_followers).toBe(0);
    expect(insights.new_followers_7d).toBe(0);
    expect(insights.lost_followers_7d).toBe(0);
    expect(insights.top_followers.length).toBe(0);
  });
});

// ---- getFollowerGrowthChart ----

describe("getFollowerGrowthChart", () => {
  test("returns growth data points", () => {
    // We already created snapshots above, so there should be data
    const chart = getFollowerGrowthChart(accountId, 30);
    expect(Array.isArray(chart)).toBe(true);
    // Should have at least the snapshots we created
    expect(chart.length).toBeGreaterThanOrEqual(1);
    for (const point of chart) {
      expect(point).toHaveProperty("date");
      expect(point).toHaveProperty("count");
    }
  });

  test("returns empty for account with no snapshots", () => {
    const chart = getFollowerGrowthChart(accountId2, 30);
    expect(chart.length).toBe(0);
  });
});

// ---- getTopFollowers ----

describe("getTopFollowers", () => {
  test("returns top followers sorted by follower_count", () => {
    const top = getTopFollowers(accountId, 5);
    expect(top.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].follower_count).toBeGreaterThanOrEqual(top[i].follower_count);
    }
  });

  test("respects limit parameter", () => {
    const top = getTopFollowers(accountId, 2);
    expect(top.length).toBeLessThanOrEqual(2);
  });

  test("returns empty for account with no followers", () => {
    const top = getTopFollowers(accountId2, 10);
    expect(top.length).toBe(0);
  });
});
