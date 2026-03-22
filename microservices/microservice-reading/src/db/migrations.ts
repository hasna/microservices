export interface MigrationEntry {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        isbn TEXT,
        status TEXT NOT NULL DEFAULT 'to_read' CHECK(status IN ('to_read','reading','completed','abandoned')),
        rating INTEGER,
        category TEXT,
        pages INTEGER,
        current_page INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        cover_url TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS highlights (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        page INTEGER,
        chapter TEXT,
        color TEXT NOT NULL DEFAULT 'yellow',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reading_sessions (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        pages_read INTEGER,
        duration_min INTEGER,
        logged_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
      CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
      CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
      CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);
      CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
      CREATE INDEX IF NOT EXISTS idx_reading_sessions_book ON reading_sessions(book_id);
      CREATE INDEX IF NOT EXISTS idx_reading_sessions_logged ON reading_sessions(logged_at);
    `,
  },
];
