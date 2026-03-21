import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createComment,
  getComment,
  listComments,
  deleteComment,
  getTopComments,
  searchComments,
  getCommentStats,
  importComments,
} from "./comments.js";
import { createTranscript } from "./transcripts.js";
import { closeDatabase } from "./database.js";

// Use a temp DB for tests
let transcriptId: string;

beforeEach(() => {
  closeDatabase();
  process.env["MICROSERVICES_DIR"] = `/tmp/test-comments-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const t = createTranscript({ source_url: "https://youtube.com/watch?v=test", source_type: "youtube" });
  transcriptId = t.id;
});

afterEach(() => {
  closeDatabase();
});

describe("createComment", () => {
  it("creates a comment with defaults", () => {
    const c = createComment({
      transcript_id: transcriptId,
      comment_text: "Great video!",
    });

    expect(c.id).toBeTruthy();
    expect(c.transcript_id).toBe(transcriptId);
    expect(c.comment_text).toBe("Great video!");
    expect(c.platform).toBe("youtube");
    expect(c.likes).toBe(0);
    expect(c.reply_count).toBe(0);
    expect(c.is_reply).toBe(0);
    expect(c.parent_comment_id).toBeNull();
  });

  it("creates a comment with all fields", () => {
    const c = createComment({
      transcript_id: transcriptId,
      platform: "vimeo",
      author: "John Doe",
      author_handle: "@johndoe",
      comment_text: "Insightful content",
      likes: 42,
      reply_count: 5,
      is_reply: true,
      parent_comment_id: "parent-123",
      published_at: "2024-01-15T10:00:00Z",
    });

    expect(c.platform).toBe("vimeo");
    expect(c.author).toBe("John Doe");
    expect(c.author_handle).toBe("@johndoe");
    expect(c.likes).toBe(42);
    expect(c.reply_count).toBe(5);
    expect(c.is_reply).toBe(1);
    expect(c.parent_comment_id).toBe("parent-123");
    expect(c.published_at).toBe("2024-01-15T10:00:00Z");
  });
});

describe("getComment", () => {
  it("returns null for unknown id", () => {
    expect(getComment("nonexistent")).toBeNull();
  });

  it("retrieves a created comment", () => {
    const c = createComment({ transcript_id: transcriptId, comment_text: "Hello" });
    const fetched = getComment(c.id);
    expect(fetched?.id).toBe(c.id);
    expect(fetched?.comment_text).toBe("Hello");
  });
});

describe("listComments", () => {
  it("returns comments for a transcript", () => {
    createComment({ transcript_id: transcriptId, comment_text: "First" });
    createComment({ transcript_id: transcriptId, comment_text: "Second" });

    const comments = listComments(transcriptId);
    expect(comments.length).toBe(2);
  });

  it("returns empty for unknown transcript", () => {
    const comments = listComments("nonexistent");
    expect(comments.length).toBe(0);
  });

  it("respects limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      createComment({ transcript_id: transcriptId, comment_text: `Comment ${i}` });
    }

    const page1 = listComments(transcriptId, { limit: 2, offset: 0 });
    expect(page1.length).toBe(2);

    const page2 = listComments(transcriptId, { limit: 2, offset: 2 });
    expect(page2.length).toBe(2);

    const page3 = listComments(transcriptId, { limit: 2, offset: 4 });
    expect(page3.length).toBe(1);
  });

  it("sorts by likes when top=true", () => {
    createComment({ transcript_id: transcriptId, comment_text: "Low", likes: 1 });
    createComment({ transcript_id: transcriptId, comment_text: "High", likes: 100 });
    createComment({ transcript_id: transcriptId, comment_text: "Mid", likes: 50 });

    const top = listComments(transcriptId, { top: true });
    expect(top[0].comment_text).toBe("High");
    expect(top[1].comment_text).toBe("Mid");
    expect(top[2].comment_text).toBe("Low");
  });
});

describe("deleteComment", () => {
  it("deletes an existing comment", () => {
    const c = createComment({ transcript_id: transcriptId, comment_text: "Delete me" });
    expect(deleteComment(c.id)).toBe(true);
    expect(getComment(c.id)).toBeNull();
  });

  it("returns false for nonexistent id", () => {
    expect(deleteComment("nonexistent")).toBe(false);
  });
});

describe("getTopComments", () => {
  it("returns top N comments by likes", () => {
    createComment({ transcript_id: transcriptId, comment_text: "A", likes: 10 });
    createComment({ transcript_id: transcriptId, comment_text: "B", likes: 50 });
    createComment({ transcript_id: transcriptId, comment_text: "C", likes: 30 });
    createComment({ transcript_id: transcriptId, comment_text: "D", likes: 5 });

    const top2 = getTopComments(transcriptId, 2);
    expect(top2.length).toBe(2);
    expect(top2[0].likes).toBe(50);
    expect(top2[1].likes).toBe(30);
  });
});

describe("searchComments", () => {
  it("finds comments by text", () => {
    createComment({ transcript_id: transcriptId, comment_text: "This is an amazing tutorial" });
    createComment({ transcript_id: transcriptId, comment_text: "Not helpful at all" });

    const results = searchComments("amazing");
    expect(results.length).toBe(1);
    expect(results[0].comment_text).toContain("amazing");
  });

  it("returns empty for no match", () => {
    createComment({ transcript_id: transcriptId, comment_text: "Hello world" });
    expect(searchComments("zzznomatch")).toHaveLength(0);
  });

  it("is case-insensitive via LIKE", () => {
    createComment({ transcript_id: transcriptId, comment_text: "GREAT video content" });

    const results = searchComments("great");
    expect(results.length).toBe(1);
  });
});

describe("getCommentStats", () => {
  it("returns stats for a transcript with comments", () => {
    createComment({ transcript_id: transcriptId, comment_text: "Top level", author: "Alice", likes: 10 });
    createComment({ transcript_id: transcriptId, comment_text: "Another", author: "Alice", likes: 20 });
    createComment({ transcript_id: transcriptId, comment_text: "Reply", author: "Bob", likes: 5, is_reply: true });

    const stats = getCommentStats(transcriptId);
    expect(stats.total).toBe(3);
    expect(stats.replies).toBe(1);
    expect(stats.unique_authors).toBe(2);
    expect(stats.avg_likes).toBeCloseTo(11.67, 1);
    expect(stats.top_commenter).toBe("Alice");
  });

  it("returns zeros for transcript with no comments", () => {
    const stats = getCommentStats(transcriptId);
    expect(stats.total).toBe(0);
    expect(stats.replies).toBe(0);
    expect(stats.unique_authors).toBe(0);
    expect(stats.avg_likes).toBe(0);
    expect(stats.top_commenter).toBeNull();
  });
});

describe("importComments", () => {
  it("bulk imports comments", () => {
    const comments = [
      { comment_text: "First comment", author: "User1", likes: 5 },
      { comment_text: "Second comment", author: "User2", likes: 10 },
      { comment_text: "Third comment", author: "User3", likes: 15 },
    ];

    const count = importComments(transcriptId, comments);
    expect(count).toBe(3);

    const all = listComments(transcriptId);
    expect(all.length).toBe(3);
  });

  it("handles empty array", () => {
    const count = importComments(transcriptId, []);
    expect(count).toBe(0);
  });

  it("imports comments with reply relationships", () => {
    const comments = [
      { comment_text: "Top level", author: "Alice", is_reply: false },
      { comment_text: "Reply to Alice", author: "Bob", is_reply: true, parent_comment_id: "parent-1" },
    ];

    importComments(transcriptId, comments);
    const all = listComments(transcriptId);

    const topLevel = all.find((c) => c.author === "Alice");
    const reply = all.find((c) => c.author === "Bob");

    expect(topLevel?.is_reply).toBe(0);
    expect(reply?.is_reply).toBe(1);
    expect(reply?.parent_comment_id).toBe("parent-1");
  });
});
