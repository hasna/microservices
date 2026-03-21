import { getDatabase } from "./database.js";

export interface Comment {
  id: string;
  transcript_id: string;
  platform: string;
  author: string | null;
  author_handle: string | null;
  comment_text: string;
  likes: number;
  reply_count: number;
  is_reply: number;
  parent_comment_id: string | null;
  published_at: string | null;
  created_at: string;
}

export interface CreateCommentInput {
  transcript_id: string;
  platform?: string;
  author?: string | null;
  author_handle?: string | null;
  comment_text: string;
  likes?: number;
  reply_count?: number;
  is_reply?: boolean;
  parent_comment_id?: string | null;
  published_at?: string | null;
}

export interface ListCommentsOptions {
  limit?: number;
  offset?: number;
  top?: boolean;
}

export interface CommentStats {
  total: number;
  replies: number;
  unique_authors: number;
  avg_likes: number;
  top_commenter: string | null;
}

export function createComment(data: CreateCommentInput): Comment {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO transcript_comments (id, transcript_id, platform, author, author_handle, comment_text, likes, reply_count, is_reply, parent_comment_id, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.transcript_id,
    data.platform ?? "youtube",
    data.author ?? null,
    data.author_handle ?? null,
    data.comment_text,
    data.likes ?? 0,
    data.reply_count ?? 0,
    data.is_reply ? 1 : 0,
    data.parent_comment_id ?? null,
    data.published_at ?? null,
  );

  return getComment(id)!;
}

export function getComment(id: string): Comment | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM transcript_comments WHERE id = ?").get(id) as Comment | null;
}

export function listComments(transcriptId: string, options: ListCommentsOptions = {}): Comment[] {
  const db = getDatabase();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const orderBy = options.top ? "likes DESC" : "created_at ASC";

  return db
    .prepare(`SELECT * FROM transcript_comments WHERE transcript_id = ? ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(transcriptId, limit, offset) as Comment[];
}

export function deleteComment(id: string): boolean {
  const db = getDatabase();
  return db.prepare("DELETE FROM transcript_comments WHERE id = ?").run(id).changes > 0;
}

export function getTopComments(transcriptId: string, limit = 10): Comment[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM transcript_comments WHERE transcript_id = ? ORDER BY likes DESC LIMIT ?")
    .all(transcriptId, limit) as Comment[];
}

export function searchComments(query: string): Comment[] {
  const db = getDatabase();
  const q = `%${query}%`;
  return db
    .prepare("SELECT * FROM transcript_comments WHERE comment_text LIKE ? ORDER BY likes DESC LIMIT 50")
    .all(q) as Comment[];
}

export function getCommentStats(transcriptId: string): CommentStats {
  const db = getDatabase();

  const total = (
    db.prepare("SELECT COUNT(*) as n FROM transcript_comments WHERE transcript_id = ?").get(transcriptId) as { n: number }
  ).n;

  const replies = (
    db.prepare("SELECT COUNT(*) as n FROM transcript_comments WHERE transcript_id = ? AND is_reply = 1").get(transcriptId) as { n: number }
  ).n;

  const uniqueAuthors = (
    db.prepare("SELECT COUNT(DISTINCT author) as n FROM transcript_comments WHERE transcript_id = ? AND author IS NOT NULL").get(transcriptId) as { n: number }
  ).n;

  const avgLikes = (
    db.prepare("SELECT AVG(likes) as avg FROM transcript_comments WHERE transcript_id = ?").get(transcriptId) as { avg: number | null }
  ).avg ?? 0;

  const topRow = db
    .prepare("SELECT author, COUNT(*) as cnt FROM transcript_comments WHERE transcript_id = ? AND author IS NOT NULL GROUP BY author ORDER BY cnt DESC LIMIT 1")
    .get(transcriptId) as { author: string; cnt: number } | null;

  return {
    total,
    replies,
    unique_authors: uniqueAuthors,
    avg_likes: Math.round(avgLikes * 100) / 100,
    top_commenter: topRow?.author ?? null,
  };
}

export function importComments(transcriptId: string, comments: Array<Omit<CreateCommentInput, "transcript_id">>): number {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO transcript_comments (id, transcript_id, platform, author, author_handle, comment_text, likes, reply_count, is_reply, parent_comment_id, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const transaction = db.transaction(() => {
    for (const c of comments) {
      stmt.run(
        crypto.randomUUID(),
        transcriptId,
        c.platform ?? "youtube",
        c.author ?? null,
        c.author_handle ?? null,
        c.comment_text,
        c.likes ?? 0,
        c.reply_count ?? 0,
        c.is_reply ? 1 : 0,
        c.parent_comment_id ?? null,
        c.published_at ?? null,
      );
      count++;
    }
  });
  transaction();

  return count;
}
