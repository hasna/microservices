/**
 * Mention monitoring — searches platform APIs for @handle mentions,
 * stores them locally, and provides reply/read/stats operations.
 */

import { getDatabase } from "../db/database.js";
import { getAccount, listAccounts, type Platform } from "../db/social.js";

// ---- Types ----

export type MentionType = "mention" | "reply" | "quote" | "dm";

export interface Mention {
  id: string;
  account_id: string;
  platform: string;
  author: string | null;
  author_handle: string | null;
  content: string | null;
  type: MentionType | null;
  platform_post_id: string | null;
  sentiment: string | null;
  read: boolean;
  created_at: string | null;
  fetched_at: string;
}

interface MentionRow {
  id: string;
  account_id: string;
  platform: string;
  author: string | null;
  author_handle: string | null;
  content: string | null;
  type: string | null;
  platform_post_id: string | null;
  sentiment: string | null;
  read: number;
  created_at: string | null;
  fetched_at: string;
}

function rowToMention(row: MentionRow): Mention {
  return {
    ...row,
    type: (row.type as MentionType) || null,
    read: row.read === 1,
  };
}

// ---- CRUD ----

export interface CreateMentionInput {
  account_id: string;
  platform: string;
  author?: string;
  author_handle?: string;
  content?: string;
  type?: MentionType;
  platform_post_id?: string;
  sentiment?: string;
  created_at?: string;
}

export function createMention(input: CreateMentionInput): Mention {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO mentions (id, account_id, platform, author, author_handle, content, type, platform_post_id, sentiment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.account_id,
    input.platform,
    input.author || null,
    input.author_handle || null,
    input.content || null,
    input.type || null,
    input.platform_post_id || null,
    input.sentiment || null,
    input.created_at || null
  );

  return getMention(id)!;
}

export function getMention(id: string): Mention | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM mentions WHERE id = ?").get(id) as MentionRow | null;
  return row ? rowToMention(row) : null;
}

export interface ListMentionsOptions {
  account_id?: string;
  unread?: boolean;
  type?: MentionType;
  platform?: string;
  limit?: number;
  offset?: number;
}

export function listMentions(accountId?: string, filters: Omit<ListMentionsOptions, "account_id"> = {}): Mention[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (accountId) {
    conditions.push("account_id = ?");
    params.push(accountId);
  }

  if (filters.unread !== undefined) {
    conditions.push("read = ?");
    params.push(filters.unread ? 0 : 1);
  }

  if (filters.type) {
    conditions.push("type = ?");
    params.push(filters.type);
  }

  if (filters.platform) {
    conditions.push("platform = ?");
    params.push(filters.platform);
  }

  let sql = "SELECT * FROM mentions";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY fetched_at DESC";

  if (filters.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }
  if (filters.offset) {
    sql += " OFFSET ?";
    params.push(filters.offset);
  }

  const rows = db.prepare(sql).all(...params) as MentionRow[];
  return rows.map(rowToMention);
}

export function markRead(id: string): Mention | null {
  const db = getDatabase();
  const existing = getMention(id);
  if (!existing) return null;

  db.prepare("UPDATE mentions SET read = 1 WHERE id = ?").run(id);
  return getMention(id);
}

export function markAllRead(accountId: string): number {
  const db = getDatabase();
  const result = db.prepare("UPDATE mentions SET read = 1 WHERE account_id = ? AND read = 0").run(accountId);
  return result.changes;
}

// ---- Stats ----

export interface MentionStats {
  total: number;
  unread: number;
  by_type: Record<string, number>;
  by_sentiment: Record<string, number>;
}

export function getMentionStats(accountId: string): MentionStats {
  const db = getDatabase();

  const totalRow = db.prepare("SELECT COUNT(*) as count FROM mentions WHERE account_id = ?").get(accountId) as { count: number };
  const unreadRow = db.prepare("SELECT COUNT(*) as count FROM mentions WHERE account_id = ? AND read = 0").get(accountId) as { count: number };

  const typeRows = db.prepare(
    "SELECT type, COUNT(*) as count FROM mentions WHERE account_id = ? AND type IS NOT NULL GROUP BY type"
  ).all(accountId) as { type: string; count: number }[];

  const sentimentRows = db.prepare(
    "SELECT sentiment, COUNT(*) as count FROM mentions WHERE account_id = ? AND sentiment IS NOT NULL GROUP BY sentiment"
  ).all(accountId) as { sentiment: string; count: number }[];

  const by_type: Record<string, number> = {};
  for (const row of typeRows) {
    by_type[row.type] = row.count;
  }

  const by_sentiment: Record<string, number> = {};
  for (const row of sentimentRows) {
    by_sentiment[row.sentiment] = row.count;
  }

  return {
    total: totalRow.count,
    unread: unreadRow.count,
    by_type,
    by_sentiment,
  };
}

// ---- Platform API search ----

/**
 * Search for @handle mentions on a platform via its API.
 * X: GET /2/tweets/search/recent?query=@handle
 * Meta: GET /{page-id}/tagged
 *
 * Returns raw mention data that can be stored with createMention().
 */
export async function searchMentions(accountId: string): Promise<CreateMentionInput[]> {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Account '${accountId}' not found.`);

  if (account.platform === "x") {
    return searchXMentions(account.id, account.handle);
  } else if (account.platform === "instagram") {
    return searchMetaMentions(account.id, account.platform);
  }

  throw new Error(`Mention search not supported for platform '${account.platform}'.`);
}

async function searchXMentions(accountId: string, handle: string): Promise<CreateMentionInput[]> {
  const bearerToken = process.env.X_BEARER_TOKEN || process.env.X_ACCESS_TOKEN;
  if (!bearerToken) throw new Error("X API: no bearer token configured. Set X_BEARER_TOKEN.");

  const query = encodeURIComponent(`@${handle}`);
  const res = await fetch(
    `https://api.twitter.com/2/tweets/search/recent?query=${query}&tweet.fields=author_id,created_at,in_reply_to_user_id&expansions=author_id&user.fields=name,username`,
    {
      headers: { Authorization: `Bearer ${bearerToken}` },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    data?: { id: string; text: string; author_id: string; created_at?: string; in_reply_to_user_id?: string }[];
    includes?: { users?: { id: string; name: string; username: string }[] };
  };

  if (!data.data) return [];

  const userMap = new Map<string, { name: string; username: string }>();
  if (data.includes?.users) {
    for (const u of data.includes.users) {
      userMap.set(u.id, { name: u.name, username: u.username });
    }
  }

  return data.data.map((tweet) => {
    const user = userMap.get(tweet.author_id);
    const mentionType: MentionType = tweet.in_reply_to_user_id ? "reply" : "mention";

    return {
      account_id: accountId,
      platform: "x",
      author: user?.name || null,
      author_handle: user?.username || null,
      content: tweet.text,
      type: mentionType,
      platform_post_id: tweet.id,
      created_at: tweet.created_at || null,
    } as CreateMentionInput;
  });
}

async function searchMetaMentions(accountId: string, platform: string): Promise<CreateMentionInput[]> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  if (!accessToken || !pageId) throw new Error("Meta API: META_ACCESS_TOKEN and META_PAGE_ID required.");

  const res = await fetch(
    `https://graph.facebook.com/v22.0/${pageId}/tagged?access_token=${encodeURIComponent(accessToken)}&fields=id,message,from,created_time`,
    { method: "GET" }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    data?: { id: string; message?: string; from?: { name: string; id: string }; created_time?: string }[];
  };

  if (!data.data) return [];

  return data.data.map((post) => ({
    account_id: accountId,
    platform,
    author: post.from?.name || null,
    author_handle: post.from?.id || null,
    content: post.message || null,
    type: "mention" as MentionType,
    platform_post_id: post.id,
    created_at: post.created_time || null,
  }));
}

// ---- Reply ----

/**
 * Reply to a mention via the platform API.
 * X: POST /2/tweets with in_reply_to_tweet_id
 * Meta: POST /{post-id}/comments
 */
export async function replyToMention(mentionId: string, content: string): Promise<{ platformReplyId: string }> {
  const mention = getMention(mentionId);
  if (!mention) throw new Error(`Mention '${mentionId}' not found.`);
  if (!mention.platform_post_id) throw new Error(`Mention '${mentionId}' has no platform_post_id to reply to.`);

  const account = getAccount(mention.account_id);
  if (!account) throw new Error(`Account '${mention.account_id}' not found.`);

  if (mention.platform === "x") {
    return replyOnX(mention.platform_post_id, content);
  } else if (mention.platform === "instagram" || mention.platform === "facebook") {
    return replyOnMeta(mention.platform_post_id, content);
  }

  throw new Error(`Reply not supported for platform '${mention.platform}'.`);
}

async function replyOnX(inReplyToId: string, content: string): Promise<{ platformReplyId: string }> {
  const bearerToken = process.env.X_BEARER_TOKEN || process.env.X_ACCESS_TOKEN;
  if (!bearerToken) throw new Error("X API: no bearer token configured.");

  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: content,
      reply: { in_reply_to_tweet_id: inReplyToId },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { data: { id: string } };
  return { platformReplyId: data.data.id };
}

async function replyOnMeta(postId: string, content: string): Promise<{ platformReplyId: string }> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) throw new Error("Meta API: META_ACCESS_TOKEN required.");

  const res = await fetch(
    `https://graph.facebook.com/v22.0/${postId}/comments?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: content }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return { platformReplyId: data.id };
}

// ---- Polling ----

let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _pollRunning = false;

/**
 * Start a background poller that periodically fetches new mentions for all
 * connected accounts and inserts them into the DB (deduped by platform_post_id).
 */
export function pollMentions(intervalMs = 120000): void {
  if (_pollRunning) throw new Error("Mention poller is already running.");

  _pollRunning = true;

  // Run immediately, then on interval
  _runPollCycle();
  _pollTimer = setInterval(_runPollCycle, intervalMs);
}

export function stopPolling(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  _pollRunning = false;
}

export function isPolling(): boolean {
  return _pollRunning;
}

async function _runPollCycle(): Promise<void> {
  const accounts = listAccounts({ connected: true });

  for (const account of accounts) {
    try {
      // Only poll platforms that support mention search
      if (account.platform !== "x" && account.platform !== "instagram") continue;

      const mentions = await searchMentions(account.id);

      for (const m of mentions) {
        // Dedup: skip if platform_post_id already exists
        if (m.platform_post_id) {
          const db = getDatabase();
          const existing = db.prepare(
            "SELECT id FROM mentions WHERE account_id = ? AND platform_post_id = ?"
          ).get(account.id, m.platform_post_id);
          if (existing) continue;
        }

        createMention(m);
      }
    } catch (_err) {
      // Silently continue — poll cycle errors should not crash the poller
    }
  }
}
