/**
 * Thread and carousel support for social media posts.
 *
 * Threads: multiple posts linked by thread_id, ordered by thread_position.
 * Carousels: a single post with multiple media_urls (Instagram/LinkedIn format).
 */

import {
  createPost,
  getAccount,
  getPost,
  updatePost,
  getThreadPosts,
  deleteThreadPosts,
  checkPlatformLimit,
  PLATFORM_LIMITS,
  type Post,
  type Platform,
} from "../db/social.js";

// ---- Types ----

export interface CreateThreadOptions {
  scheduledAt?: string;
  tags?: string[];
}

export interface ThreadResult {
  threadId: string;
  posts: Post[];
}

export interface PublishThreadResult {
  threadId: string;
  posts: Post[];
  platformPostIds: string[];
}

// ---- Thread Operations ----

/**
 * Create a thread of posts linked by a shared thread_id.
 * Each post is validated against the platform's character limit.
 */
export function createThread(
  contents: string[],
  accountId: string,
  options?: CreateThreadOptions
): ThreadResult {
  if (contents.length === 0) {
    throw new Error("Thread must have at least one post.");
  }

  const account = getAccount(accountId);
  if (!account) {
    throw new Error(`Account '${accountId}' not found.`);
  }

  const limit = PLATFORM_LIMITS[account.platform];
  for (let i = 0; i < contents.length; i++) {
    if (contents[i].length > limit) {
      throw new Error(
        `Post ${i + 1} (${contents[i].length} chars) exceeds ${account.platform} limit (${limit} chars).`
      );
    }
  }

  const threadId = crypto.randomUUID();
  const posts: Post[] = [];

  for (let i = 0; i < contents.length; i++) {
    const post = createPost({
      account_id: accountId,
      content: contents[i],
      status: options?.scheduledAt ? "scheduled" : "draft",
      scheduled_at: options?.scheduledAt,
      tags: options?.tags,
      thread_id: threadId,
      thread_position: i,
    });
    posts.push(post);
  }

  return { threadId, posts };
}

/**
 * Get all posts in a thread, ordered by position.
 */
export function getThread(threadId: string): Post[] {
  const posts = getThreadPosts(threadId);
  if (posts.length === 0) {
    throw new Error(`Thread '${threadId}' not found.`);
  }
  return posts;
}

/**
 * Publish a thread sequentially via platform APIs.
 *
 * - X: POST /2/tweets chaining each reply to the previous tweet
 * - Meta: POST /{page-id}/feed for first post, then POST /{post-id}/comments for rest
 *
 * Each post gets its platform_post_id stored.
 */
export async function publishThread(threadId: string): Promise<PublishThreadResult> {
  const posts = getThreadPosts(threadId);
  if (posts.length === 0) {
    throw new Error(`Thread '${threadId}' not found.`);
  }

  const firstPost = posts[0];
  const account = getAccount(firstPost.account_id);
  if (!account) {
    throw new Error(`Account '${firstPost.account_id}' not found.`);
  }

  const platformPostIds: string[] = [];
  const updatedPosts: Post[] = [];

  if (account.platform === "x") {
    // X: chain tweets using reply.in_reply_to_tweet_id
    const { XPublisher } = await import("./publisher.js");
    const publisher = new XPublisher();

    let previousTweetId: string | null = null;

    for (const post of posts) {
      const body: Record<string, unknown> = { text: post.content };
      if (previousTweetId) {
        body.reply = { in_reply_to_tweet_id: previousTweetId };
      }

      // Use the publisher's publishPost for the first, then raw fetch for replies
      const res = await fetch("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.X_BEARER_TOKEN || process.env.X_ACCESS_TOKEN || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        // Mark remaining posts as failed
        for (const remaining of posts.filter((p) => !platformPostIds.includes(p.platform_post_id || ""))) {
          if (!platformPostIds.some((pid) => pid === remaining.platform_post_id)) {
            updatePost(remaining.id, { status: "failed" });
          }
        }
        throw new Error(`X API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as { data: { id: string } };
      const tweetId = data.data.id;
      previousTweetId = tweetId;
      platformPostIds.push(tweetId);

      const updated = updatePost(post.id, {
        status: "published",
        published_at: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
        platform_post_id: tweetId,
      });
      updatedPosts.push(updated!);
    }
  } else if (account.platform === "instagram" || account.platform === "linkedin") {
    // Meta-style: first post to feed, rest as comments
    const accessToken = process.env.META_ACCESS_TOKEN || "";
    const pageId = process.env.META_PAGE_ID || account.handle;
    const baseUrl = "https://graph.facebook.com/v22.0";

    // First post
    const firstRes = await fetch(
      `${baseUrl}/${pageId}/feed?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: posts[0].content }),
      }
    );

    if (!firstRes.ok) {
      const text = await firstRes.text();
      throw new Error(`Meta API error ${firstRes.status}: ${text}`);
    }

    const firstData = (await firstRes.json()) as { id: string };
    platformPostIds.push(firstData.id);
    const firstUpdated = updatePost(posts[0].id, {
      status: "published",
      published_at: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
      platform_post_id: firstData.id,
    });
    updatedPosts.push(firstUpdated!);

    // Rest as comments on the first post
    for (let i = 1; i < posts.length; i++) {
      const commentRes = await fetch(
        `${baseUrl}/${firstData.id}/comments?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: posts[i].content }),
        }
      );

      if (!commentRes.ok) {
        const text = await commentRes.text();
        throw new Error(`Meta API error ${commentRes.status}: ${text}`);
      }

      const commentData = (await commentRes.json()) as { id: string };
      platformPostIds.push(commentData.id);

      const updated = updatePost(posts[i].id, {
        status: "published",
        published_at: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
        platform_post_id: commentData.id,
      });
      updatedPosts.push(updated!);
    }
  } else {
    // For unsupported platforms, publish each post individually via the generic publisher
    const { publishToApi } = await import("./publisher.js");

    for (const post of posts) {
      try {
        const updated = await publishToApi(post.id);
        platformPostIds.push(updated.platform_post_id || "");
        updatedPosts.push(updated);
      } catch (err) {
        throw err;
      }
    }
  }

  return { threadId, posts: updatedPosts, platformPostIds };
}

/**
 * Delete an entire thread and all its posts.
 */
export function deleteThread(threadId: string): number {
  const posts = getThreadPosts(threadId);
  if (posts.length === 0) {
    throw new Error(`Thread '${threadId}' not found.`);
  }
  return deleteThreadPosts(threadId);
}

// ---- Carousel ----

/**
 * Create a carousel post — a single post with multiple media_urls.
 * Used for Instagram/LinkedIn carousel format.
 */
export function createCarousel(
  images: string[],
  captions: string[],
  accountId: string
): Post {
  if (images.length === 0) {
    throw new Error("Carousel must have at least one image.");
  }

  const account = getAccount(accountId);
  if (!account) {
    throw new Error(`Account '${accountId}' not found.`);
  }

  // Use the first caption or combine all captions as the post content
  const content = captions.length > 0 ? captions.join("\n\n") : "";

  // Validate content length against platform limit
  if (content.length > 0) {
    const limit = PLATFORM_LIMITS[account.platform];
    if (content.length > limit) {
      throw new Error(
        `Carousel caption (${content.length} chars) exceeds ${account.platform} limit (${limit} chars).`
      );
    }
  }

  return createPost({
    account_id: accountId,
    content,
    media_urls: images,
    status: "draft",
  });
}
