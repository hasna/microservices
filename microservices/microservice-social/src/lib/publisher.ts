/**
 * Platform publisher bridge — connects social microservice to real platform APIs.
 *
 * Supports X (Twitter) and Meta (Facebook Pages) via direct HTTP calls to their
 * public APIs. No dependency on open-connectors at runtime — we replicate only
 * the minimal fetch logic needed so the microservice stays self-contained.
 */

import { getPost, getAccount, updatePost, type Post, type Engagement } from "../db/social.js";

// ---- Interfaces ----

export interface PublishResult {
  platformPostId: string;
  url?: string;
}

export interface PostMetrics {
  likes: number;
  shares: number;
  comments: number;
  impressions: number;
  clicks: number;
}

export interface PlatformPublisher {
  /** Publish content to the platform. Returns the platform-native post ID. */
  publishPost(content: string, mediaIds?: string[]): Promise<PublishResult>;
  /** Delete a post by its platform-native ID. */
  deletePost(platformPostId: string): Promise<boolean>;
  /** Fetch engagement metrics for a published post. */
  getPostMetrics(platformPostId: string): Promise<PostMetrics>;
}

// ---- X (Twitter) Publisher ----

interface XAuthConfig {
  bearerToken?: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessSecret?: string;
}

function getXAuth(): XAuthConfig {
  return {
    bearerToken: process.env.X_BEARER_TOKEN,
    apiKey: process.env.X_API_KEY,
    apiSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  };
}

export class XPublisher implements PlatformPublisher {
  private readonly baseUrl = "https://api.twitter.com";
  private auth: XAuthConfig;

  constructor(auth?: XAuthConfig) {
    this.auth = auth || getXAuth();
  }

  private getAuthHeader(): string {
    if (this.auth.bearerToken) {
      return `Bearer ${this.auth.bearerToken}`;
    }
    // OAuth 2.0 user access token
    if (this.auth.accessToken) {
      return `Bearer ${this.auth.accessToken}`;
    }
    throw new Error("X publisher: no valid auth token. Set X_BEARER_TOKEN or X_ACCESS_TOKEN.");
  }

  async publishPost(content: string, mediaIds?: string[]): Promise<PublishResult> {
    const body: Record<string, unknown> = { text: content };
    if (mediaIds?.length) {
      body.media = { media_ids: mediaIds };
    }

    const res = await fetch(`${this.baseUrl}/2/tweets`, {
      method: "POST",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`X API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { data: { id: string; text: string } };
    return {
      platformPostId: data.data.id,
      url: `https://x.com/i/status/${data.data.id}`,
    };
  }

  async deletePost(platformPostId: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/2/tweets/${platformPostId}`, {
      method: "DELETE",
      headers: { Authorization: this.getAuthHeader() },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`X API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { data: { deleted: boolean } };
    return data.data.deleted;
  }

  async getPostMetrics(platformPostId: string): Promise<PostMetrics> {
    const res = await fetch(
      `${this.baseUrl}/2/tweets/${platformPostId}?tweet.fields=public_metrics`,
      {
        method: "GET",
        headers: { Authorization: this.getAuthHeader() },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`X API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      data: {
        public_metrics: {
          like_count: number;
          retweet_count: number;
          reply_count: number;
          impression_count: number;
          bookmark_count: number;
        };
      };
    };

    const m = data.data.public_metrics;
    return {
      likes: m.like_count,
      shares: m.retweet_count,
      comments: m.reply_count,
      impressions: m.impression_count,
      clicks: m.bookmark_count, // X doesn't expose link clicks via v2; bookmark is closest proxy
    };
  }
}

// ---- Meta (Facebook Pages) Publisher ----

interface MetaAuthConfig {
  accessToken?: string;
  pageId?: string;
}

function getMetaAuth(): MetaAuthConfig {
  return {
    accessToken: process.env.META_ACCESS_TOKEN,
    pageId: process.env.META_PAGE_ID,
  };
}

export class MetaPublisher implements PlatformPublisher {
  private readonly baseUrl = "https://graph.facebook.com/v22.0";
  private auth: MetaAuthConfig;

  constructor(auth?: MetaAuthConfig) {
    this.auth = auth || getMetaAuth();
  }

  private requireAuth(): { accessToken: string; pageId: string } {
    if (!this.auth.accessToken) {
      throw new Error("Meta publisher: META_ACCESS_TOKEN is required.");
    }
    if (!this.auth.pageId) {
      throw new Error("Meta publisher: META_PAGE_ID is required.");
    }
    return { accessToken: this.auth.accessToken, pageId: this.auth.pageId };
  }

  async publishPost(content: string, _mediaIds?: string[]): Promise<PublishResult> {
    const { accessToken, pageId } = this.requireAuth();

    const res = await fetch(
      `${this.baseUrl}/${pageId}/feed?access_token=${encodeURIComponent(accessToken)}`,
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
    return {
      platformPostId: data.id,
      url: `https://facebook.com/${data.id}`,
    };
  }

  async deletePost(platformPostId: string): Promise<boolean> {
    const { accessToken } = this.requireAuth();

    const res = await fetch(
      `${this.baseUrl}/${platformPostId}?access_token=${encodeURIComponent(accessToken)}`,
      { method: "DELETE" }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { success: boolean };
    return data.success;
  }

  async getPostMetrics(platformPostId: string): Promise<PostMetrics> {
    const { accessToken } = this.requireAuth();

    const fields = "shares,reactions.summary(true),comments.summary(true),insights.metric(post_impressions,post_clicks)";
    const res = await fetch(
      `${this.baseUrl}/${platformPostId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`,
      { method: "GET" }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      shares?: { count: number };
      reactions?: { summary: { total_count: number } };
      comments?: { summary: { total_count: number } };
      insights?: { data: { name: string; values: { value: number }[] }[] };
    };

    let impressions = 0;
    let clicks = 0;
    if (data.insights?.data) {
      for (const metric of data.insights.data) {
        if (metric.name === "post_impressions" && metric.values?.[0]) {
          impressions = metric.values[0].value;
        }
        if (metric.name === "post_clicks" && metric.values?.[0]) {
          clicks = metric.values[0].value;
        }
      }
    }

    return {
      likes: data.reactions?.summary?.total_count ?? 0,
      shares: data.shares?.count ?? 0,
      comments: data.comments?.summary?.total_count ?? 0,
      impressions,
      clicks,
    };
  }
}

// ---- Factory ----

const publishers: Record<string, () => PlatformPublisher> = {
  x: () => new XPublisher(),
  meta: () => new MetaPublisher(),
  facebook: () => new MetaPublisher(),
};

/**
 * Get a publisher instance for the given platform string.
 * Throws if the platform is not supported.
 */
export function getPublisher(platform: string): PlatformPublisher {
  const factory = publishers[platform.toLowerCase()];
  if (!factory) {
    throw new Error(`Unsupported publishing platform: '${platform}'. Supported: ${Object.keys(publishers).join(", ")}`);
  }
  return factory();
}

/**
 * Check which platform providers have env vars configured.
 */
export function checkProviders(): { x: boolean; meta: boolean } {
  const xAuth = getXAuth();
  const metaAuth = getMetaAuth();

  return {
    x: !!(xAuth.bearerToken || (xAuth.accessToken)),
    meta: !!(metaAuth.accessToken && metaAuth.pageId),
  };
}

// ---- High-level publish function ----

/**
 * Publish a post to its platform API.
 *
 * 1. Loads the post and its account from DB
 * 2. Gets the appropriate publisher for the account's platform
 * 3. Calls the platform API
 * 4. Updates the post in DB with platform_post_id and status='published'
 *
 * Returns the updated post.
 */
export async function publishToApi(postId: string): Promise<Post> {
  const post = getPost(postId);
  if (!post) {
    throw new Error(`Post '${postId}' not found.`);
  }

  if (post.status === "published") {
    throw new Error(`Post '${postId}' is already published.`);
  }

  const account = getAccount(post.account_id);
  if (!account) {
    throw new Error(`Account '${post.account_id}' not found for post '${postId}'.`);
  }

  // Map the social account platform to a publisher key
  // instagram/threads/bluesky/linkedin don't have publishers yet
  const platformKey = account.platform === "x" ? "x" : account.platform;
  const publisher = getPublisher(platformKey);

  try {
    const result = await publisher.publishPost(post.content, post.media_urls.length ? post.media_urls : undefined);

    const updated = updatePost(postId, {
      status: "published",
      published_at: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
      platform_post_id: result.platformPostId,
    });

    return updated!;
  } catch (err) {
    // Mark as failed with the error info
    updatePost(postId, { status: "failed" });
    throw err;
  }
}

/**
 * Fetch metrics from the platform API and sync them into the DB engagement column.
 */
export async function syncPostMetrics(postId: string): Promise<Post> {
  const post = getPost(postId);
  if (!post) throw new Error(`Post '${postId}' not found.`);
  if (!post.platform_post_id) throw new Error(`Post '${postId}' has no platform_post_id.`);

  const account = getAccount(post.account_id);
  if (!account) throw new Error(`Account '${post.account_id}' not found.`);

  const platformKey = account.platform === "x" ? "x" : account.platform;
  const publisher = getPublisher(platformKey);
  const metrics = await publisher.getPostMetrics(post.platform_post_id);

  const engagement: Engagement = {
    likes: metrics.likes,
    shares: metrics.shares,
    comments: metrics.comments,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
  };

  const updated = updatePost(postId, { engagement });
  return updated!;
}
