/**
 * Reading CRUD operations — books, highlights, reading sessions
 */

import { getDatabase } from "./database.js";

// ============ Types ============

export interface Book {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  status: "to_read" | "reading" | "completed" | "abandoned";
  rating: number | null;
  category: string | null;
  pages: number | null;
  current_page: number;
  started_at: string | null;
  finished_at: string | null;
  cover_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  status: string;
  rating: number | null;
  category: string | null;
  pages: number | null;
  current_page: number;
  started_at: string | null;
  finished_at: string | null;
  cover_url: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToBook(row: BookRow): Book {
  return {
    ...row,
    status: row.status as Book["status"],
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface Highlight {
  id: string;
  book_id: string;
  text: string;
  page: number | null;
  chapter: string | null;
  color: string;
  notes: string | null;
  created_at: string;
}

export interface ReadingSession {
  id: string;
  book_id: string;
  pages_read: number | null;
  duration_min: number | null;
  logged_at: string;
  created_at: string;
}

// ============ Book CRUD ============

export interface CreateBookInput {
  title: string;
  author?: string;
  isbn?: string;
  status?: "to_read" | "reading" | "completed" | "abandoned";
  rating?: number;
  category?: string;
  pages?: number;
  current_page?: number;
  started_at?: string;
  finished_at?: string;
  cover_url?: string;
  metadata?: Record<string, unknown>;
}

export function createBook(input: CreateBookInput): Book {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO books (id, title, author, isbn, status, rating, category, pages, current_page, started_at, finished_at, cover_url, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.author || null,
    input.isbn || null,
    input.status || "to_read",
    input.rating ?? null,
    input.category || null,
    input.pages ?? null,
    input.current_page ?? 0,
    input.started_at || null,
    input.finished_at || null,
    input.cover_url || null,
    metadata
  );

  return getBook(id)!;
}

export function getBook(id: string): Book | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM books WHERE id = ?").get(id) as BookRow | null;
  return row ? rowToBook(row) : null;
}

export interface ListBooksOptions {
  search?: string;
  status?: string;
  category?: string;
  author?: string;
  limit?: number;
  offset?: number;
}

export function listBooks(options: ListBooksOptions = {}): Book[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push("(title LIKE ? OR author LIKE ? OR isbn LIKE ? OR category LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q, q);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }

  if (options.author) {
    conditions.push("author LIKE ?");
    params.push(`%${options.author}%`);
  }

  let sql = "SELECT * FROM books";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY updated_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as BookRow[];
  return rows.map(rowToBook);
}

export interface UpdateBookInput {
  title?: string;
  author?: string;
  isbn?: string;
  status?: "to_read" | "reading" | "completed" | "abandoned";
  rating?: number;
  category?: string;
  pages?: number;
  current_page?: number;
  started_at?: string;
  finished_at?: string;
  cover_url?: string;
  metadata?: Record<string, unknown>;
}

export function updateBook(id: string, input: UpdateBookInput): Book | null {
  const db = getDatabase();
  const existing = getBook(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title); }
  if (input.author !== undefined) { sets.push("author = ?"); params.push(input.author); }
  if (input.isbn !== undefined) { sets.push("isbn = ?"); params.push(input.isbn); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.rating !== undefined) { sets.push("rating = ?"); params.push(input.rating); }
  if (input.category !== undefined) { sets.push("category = ?"); params.push(input.category); }
  if (input.pages !== undefined) { sets.push("pages = ?"); params.push(input.pages); }
  if (input.current_page !== undefined) { sets.push("current_page = ?"); params.push(input.current_page); }
  if (input.started_at !== undefined) { sets.push("started_at = ?"); params.push(input.started_at); }
  if (input.finished_at !== undefined) { sets.push("finished_at = ?"); params.push(input.finished_at); }
  if (input.cover_url !== undefined) { sets.push("cover_url = ?"); params.push(input.cover_url); }
  if (input.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE books SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getBook(id);
}

export function deleteBook(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM books WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchBooks(query: string): Book[] {
  return listBooks({ search: query });
}

export function countBooks(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM books").get() as { count: number };
  return row.count;
}

// ============ Status Transitions ============

export function startBook(id: string): Book | null {
  return updateBook(id, {
    status: "reading",
    started_at: new Date().toISOString(),
  });
}

export function finishBook(id: string, rating?: number): Book | null {
  const book = getBook(id);
  if (!book) return null;

  const input: UpdateBookInput = {
    status: "completed",
    finished_at: new Date().toISOString(),
    current_page: book.pages ?? book.current_page,
  };
  if (rating !== undefined) input.rating = rating;

  return updateBook(id, input);
}

export function abandonBook(id: string): Book | null {
  return updateBook(id, { status: "abandoned" });
}

export function getCurrentlyReading(): Book[] {
  return listBooks({ status: "reading" });
}

// ============ Highlights ============

export interface CreateHighlightInput {
  book_id: string;
  text: string;
  page?: number;
  chapter?: string;
  color?: string;
  notes?: string;
}

export function createHighlight(input: CreateHighlightInput): Highlight {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO highlights (id, book_id, text, page, chapter, color, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.book_id,
    input.text,
    input.page ?? null,
    input.chapter || null,
    input.color || "yellow",
    input.notes || null
  );

  return getHighlight(id)!;
}

export function getHighlight(id: string): Highlight | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM highlights WHERE id = ?").get(id) as Highlight | null;
}

export function listHighlights(bookId: string): Highlight[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM highlights WHERE book_id = ? ORDER BY page ASC, created_at ASC")
    .all(bookId) as Highlight[];
}

export function deleteHighlight(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM highlights WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchHighlights(query: string): (Highlight & { book_title: string })[] {
  const db = getDatabase();
  const q = `%${query}%`;
  return db
    .prepare(
      `SELECT h.*, b.title as book_title
       FROM highlights h
       JOIN books b ON h.book_id = b.id
       WHERE h.text LIKE ? OR h.notes LIKE ?
       ORDER BY h.created_at DESC`
    )
    .all(q, q) as (Highlight & { book_title: string })[];
}

// ============ Reading Sessions ============

export interface CreateReadingSessionInput {
  book_id: string;
  pages_read?: number;
  duration_min?: number;
  logged_at: string;
}

export function createReadingSession(input: CreateReadingSessionInput): ReadingSession {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO reading_sessions (id, book_id, pages_read, duration_min, logged_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    input.book_id,
    input.pages_read ?? null,
    input.duration_min ?? null,
    input.logged_at
  );

  // Update book's current_page if pages_read is provided
  if (input.pages_read) {
    const book = getBook(input.book_id);
    if (book) {
      const newPage = book.current_page + input.pages_read;
      updateBook(input.book_id, { current_page: newPage });
    }
  }

  return getReadingSession(id)!;
}

export function getReadingSession(id: string): ReadingSession | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM reading_sessions WHERE id = ?").get(id) as ReadingSession | null;
}

export function listReadingSessions(bookId: string): ReadingSession[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM reading_sessions WHERE book_id = ? ORDER BY logged_at DESC")
    .all(bookId) as ReadingSession[];
}

export function deleteReadingSession(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM reading_sessions WHERE id = ?").run(id);
  return result.changes > 0;
}

// ============ Stats ============

export interface ReadingStats {
  books_read: number;
  pages_read: number;
  total_sessions: number;
  avg_rating: number | null;
  by_category: Record<string, number>;
}

export function getReadingStats(year?: number): ReadingStats {
  const db = getDatabase();

  let yearCondition = "";
  const yearParams: unknown[] = [];
  if (year) {
    yearCondition = " AND strftime('%Y', finished_at) = ?";
    yearParams.push(String(year));
  }

  // Books read (completed)
  const booksRow = db
    .prepare(`SELECT COUNT(*) as count FROM books WHERE status = 'completed'${yearCondition}`)
    .get(...yearParams) as { count: number };

  // Avg rating
  const ratingRow = db
    .prepare(`SELECT AVG(rating) as avg FROM books WHERE status = 'completed' AND rating IS NOT NULL${yearCondition}`)
    .get(...yearParams) as { avg: number | null };

  // Pages read from sessions
  let sessionYearCondition = "";
  const sessionYearParams: unknown[] = [];
  if (year) {
    sessionYearCondition = " WHERE strftime('%Y', logged_at) = ?";
    sessionYearParams.push(String(year));
  }

  const pagesRow = db
    .prepare(`SELECT COALESCE(SUM(pages_read), 0) as total FROM reading_sessions${sessionYearCondition}`)
    .get(...sessionYearParams) as { total: number };

  const sessionsRow = db
    .prepare(`SELECT COUNT(*) as count FROM reading_sessions${sessionYearCondition}`)
    .get(...sessionYearParams) as { count: number };

  // By category
  const categoryRows = db
    .prepare(
      `SELECT category, COUNT(*) as count FROM books WHERE status = 'completed' AND category IS NOT NULL${yearCondition} GROUP BY category ORDER BY count DESC`
    )
    .all(...yearParams) as { category: string; count: number }[];

  const by_category: Record<string, number> = {};
  for (const row of categoryRows) {
    by_category[row.category] = row.count;
  }

  return {
    books_read: booksRow.count,
    pages_read: pagesRow.total,
    total_sessions: sessionsRow.count,
    avg_rating: ratingRow.avg ? Math.round(ratingRow.avg * 10) / 10 : null,
    by_category,
  };
}

export interface ReadingPace {
  pages_per_day: number;
  books_per_month: number;
  avg_session_pages: number;
  avg_session_minutes: number | null;
}

export function getReadingPace(): ReadingPace {
  const db = getDatabase();

  // Get first and last session dates to calculate span
  const rangeRow = db
    .prepare(
      `SELECT MIN(logged_at) as first_session, MAX(logged_at) as last_session,
              COALESCE(SUM(pages_read), 0) as total_pages,
              COUNT(*) as total_sessions,
              AVG(pages_read) as avg_pages,
              AVG(duration_min) as avg_min
       FROM reading_sessions`
    )
    .get() as {
      first_session: string | null;
      last_session: string | null;
      total_pages: number;
      total_sessions: number;
      avg_pages: number | null;
      avg_min: number | null;
    };

  if (!rangeRow.first_session || rangeRow.total_sessions === 0) {
    return { pages_per_day: 0, books_per_month: 0, avg_session_pages: 0, avg_session_minutes: null };
  }

  const first = new Date(rangeRow.first_session);
  const last = new Date(rangeRow.last_session!);
  const daySpan = Math.max(1, Math.ceil((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24)));

  const pagesPerDay = Math.round((rangeRow.total_pages / daySpan) * 10) / 10;

  // Books completed in this period
  const booksRow = db
    .prepare(`SELECT COUNT(*) as count FROM books WHERE status = 'completed'`)
    .get() as { count: number };

  const monthSpan = Math.max(1, daySpan / 30);
  const booksPerMonth = Math.round((booksRow.count / monthSpan) * 10) / 10;

  return {
    pages_per_day: pagesPerDay,
    books_per_month: booksPerMonth,
    avg_session_pages: Math.round((rangeRow.avg_pages || 0) * 10) / 10,
    avg_session_minutes: rangeRow.avg_min ? Math.round(rangeRow.avg_min * 10) / 10 : null,
  };
}

export interface BookProgress {
  current_page: number;
  total_pages: number | null;
  percentage: number | null;
}

export function getBookProgress(bookId: string): BookProgress | null {
  const book = getBook(bookId);
  if (!book) return null;

  return {
    current_page: book.current_page,
    total_pages: book.pages,
    percentage: book.pages ? Math.round((book.current_page / book.pages) * 100) : null,
  };
}
