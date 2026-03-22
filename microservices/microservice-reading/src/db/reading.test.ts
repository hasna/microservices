import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-reading-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createBook,
  getBook,
  listBooks,
  updateBook,
  deleteBook,
  searchBooks,
  countBooks,
  startBook,
  finishBook,
  abandonBook,
  getCurrentlyReading,
  getBookProgress,
  createHighlight,
  getHighlight,
  listHighlights,
  deleteHighlight,
  searchHighlights,
  createReadingSession,
  getReadingSession,
  listReadingSessions,
  deleteReadingSession,
  getReadingStats,
  getReadingPace,
} from "./reading";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============ Books ============

describe("Books", () => {
  test("create and get book", () => {
    const book = createBook({
      title: "The Pragmatic Programmer",
      author: "David Thomas",
      isbn: "978-0135957059",
      category: "Programming",
      pages: 352,
    });

    expect(book.id).toBeTruthy();
    expect(book.title).toBe("The Pragmatic Programmer");
    expect(book.author).toBe("David Thomas");
    expect(book.isbn).toBe("978-0135957059");
    expect(book.status).toBe("to_read");
    expect(book.current_page).toBe(0);
    expect(book.pages).toBe(352);

    const fetched = getBook(book.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(book.id);
    expect(fetched!.title).toBe("The Pragmatic Programmer");
  });

  test("list books", () => {
    createBook({ title: "Clean Code", author: "Robert Martin", category: "Programming" });
    const all = listBooks();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list books with status filter", () => {
    const toRead = listBooks({ status: "to_read" });
    expect(toRead.length).toBeGreaterThanOrEqual(2);
    expect(toRead.every((b) => b.status === "to_read")).toBe(true);
  });

  test("list books with category filter", () => {
    const programming = listBooks({ category: "Programming" });
    expect(programming.length).toBeGreaterThanOrEqual(1);
    expect(programming.every((b) => b.category === "Programming")).toBe(true);
  });

  test("list books with author filter", () => {
    const results = listBooks({ author: "David Thomas" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].author).toBe("David Thomas");
  });

  test("search books", () => {
    const results = searchBooks("Pragmatic");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("The Pragmatic Programmer");
  });

  test("update book", () => {
    const book = createBook({ title: "Test Update Book" });
    const updated = updateBook(book.id, {
      author: "New Author",
      rating: 4,
      category: "Fiction",
    });

    expect(updated).toBeDefined();
    expect(updated!.author).toBe("New Author");
    expect(updated!.rating).toBe(4);
    expect(updated!.category).toBe("Fiction");
  });

  test("update non-existent book returns null", () => {
    const result = updateBook("non-existent-id", { title: "Nope" });
    expect(result).toBeNull();
  });

  test("delete book", () => {
    const book = createBook({ title: "DeleteMe Book" });
    expect(deleteBook(book.id)).toBe(true);
    expect(getBook(book.id)).toBeNull();
  });

  test("delete non-existent book returns false", () => {
    expect(deleteBook("non-existent-id")).toBe(false);
  });

  test("count books", () => {
    const count = countBooks();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("start book sets status to reading", () => {
    const book = createBook({ title: "Start Me" });
    const started = startBook(book.id);

    expect(started).toBeDefined();
    expect(started!.status).toBe("reading");
    expect(started!.started_at).toBeTruthy();
  });

  test("finish book sets status to completed", () => {
    const book = createBook({ title: "Finish Me", pages: 200 });
    startBook(book.id);
    const finished = finishBook(book.id, 5);

    expect(finished).toBeDefined();
    expect(finished!.status).toBe("completed");
    expect(finished!.finished_at).toBeTruthy();
    expect(finished!.rating).toBe(5);
    expect(finished!.current_page).toBe(200);
  });

  test("abandon book sets status to abandoned", () => {
    const book = createBook({ title: "Abandon Me" });
    startBook(book.id);
    const abandoned = abandonBook(book.id);

    expect(abandoned).toBeDefined();
    expect(abandoned!.status).toBe("abandoned");
  });

  test("currently reading returns only books with status=reading", () => {
    const book = createBook({ title: "Currently Reading Test" });
    startBook(book.id);

    const reading = getCurrentlyReading();
    expect(reading.length).toBeGreaterThanOrEqual(1);
    expect(reading.every((b) => b.status === "reading")).toBe(true);
  });

  test("get book progress", () => {
    const book = createBook({ title: "Progress Test", pages: 300 });
    updateBook(book.id, { current_page: 150 });

    const progress = getBookProgress(book.id);
    expect(progress).toBeDefined();
    expect(progress!.current_page).toBe(150);
    expect(progress!.total_pages).toBe(300);
    expect(progress!.percentage).toBe(50);
  });

  test("get book progress returns null for missing book", () => {
    expect(getBookProgress("non-existent-id")).toBeNull();
  });

  test("get book progress with no pages returns null percentage", () => {
    const book = createBook({ title: "No Pages Book" });
    const progress = getBookProgress(book.id);
    expect(progress).toBeDefined();
    expect(progress!.percentage).toBeNull();
  });

  test("book metadata is JSON parsed", () => {
    const book = createBook({
      title: "Meta Book",
      metadata: { source: "library", edition: 2 },
    });

    const fetched = getBook(book.id);
    expect(fetched!.metadata).toEqual({ source: "library", edition: 2 });
  });
});

// ============ Highlights ============

describe("Highlights", () => {
  test("create and get highlight", () => {
    const book = createBook({ title: "Highlight Book" });
    const highlight = createHighlight({
      book_id: book.id,
      text: "This is an important passage",
      page: 42,
      chapter: "Chapter 3",
      color: "blue",
      notes: "Key insight",
    });

    expect(highlight.id).toBeTruthy();
    expect(highlight.book_id).toBe(book.id);
    expect(highlight.text).toBe("This is an important passage");
    expect(highlight.page).toBe(42);
    expect(highlight.chapter).toBe("Chapter 3");
    expect(highlight.color).toBe("blue");
    expect(highlight.notes).toBe("Key insight");

    const fetched = getHighlight(highlight.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(highlight.id);
  });

  test("list highlights for a book", () => {
    const book = createBook({ title: "Multi Highlight Book" });
    createHighlight({ book_id: book.id, text: "First highlight", page: 10 });
    createHighlight({ book_id: book.id, text: "Second highlight", page: 20 });

    const highlights = listHighlights(book.id);
    expect(highlights.length).toBe(2);
    // Should be ordered by page
    expect(highlights[0].page).toBe(10);
    expect(highlights[1].page).toBe(20);
  });

  test("delete highlight", () => {
    const book = createBook({ title: "Delete Highlight Book" });
    const highlight = createHighlight({ book_id: book.id, text: "Delete me" });
    expect(deleteHighlight(highlight.id)).toBe(true);
    expect(getHighlight(highlight.id)).toBeNull();
  });

  test("search highlights across books", () => {
    const book1 = createBook({ title: "Search Book One" });
    const book2 = createBook({ title: "Search Book Two" });
    createHighlight({ book_id: book1.id, text: "The meaning of life is complex" });
    createHighlight({ book_id: book2.id, text: "Life is what happens when you make plans" });
    createHighlight({ book_id: book2.id, text: "Something unrelated" });

    const results = searchHighlights("life");
    expect(results.length).toBe(2);
    // Each result should include book_title
    expect(results[0].book_title).toBeTruthy();
  });

  test("highlight default color is yellow", () => {
    const book = createBook({ title: "Default Color Book" });
    const highlight = createHighlight({ book_id: book.id, text: "Yellow highlight" });
    expect(highlight.color).toBe("yellow");
  });

  test("highlights are cascade deleted with book", () => {
    const book = createBook({ title: "Cascade Book" });
    createHighlight({ book_id: book.id, text: "Will be deleted" });
    createHighlight({ book_id: book.id, text: "Also deleted" });

    deleteBook(book.id);
    const highlights = listHighlights(book.id);
    expect(highlights.length).toBe(0);
  });
});

// ============ Reading Sessions ============

describe("Reading Sessions", () => {
  test("create and get reading session", () => {
    const book = createBook({ title: "Session Book", pages: 400 });
    const session = createReadingSession({
      book_id: book.id,
      pages_read: 30,
      duration_min: 45,
      logged_at: "2026-01-15T20:00:00Z",
    });

    expect(session.id).toBeTruthy();
    expect(session.book_id).toBe(book.id);
    expect(session.pages_read).toBe(30);
    expect(session.duration_min).toBe(45);
    expect(session.logged_at).toBe("2026-01-15T20:00:00Z");

    const fetched = getReadingSession(session.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(session.id);
  });

  test("reading session updates book current_page", () => {
    const book = createBook({ title: "Page Update Book", pages: 300 });
    createReadingSession({
      book_id: book.id,
      pages_read: 50,
      logged_at: "2026-01-16T10:00:00Z",
    });

    const updated = getBook(book.id);
    expect(updated!.current_page).toBe(50);

    // Log another session
    createReadingSession({
      book_id: book.id,
      pages_read: 30,
      logged_at: "2026-01-17T10:00:00Z",
    });

    const updated2 = getBook(book.id);
    expect(updated2!.current_page).toBe(80);
  });

  test("list reading sessions for a book", () => {
    const book = createBook({ title: "List Sessions Book" });
    createReadingSession({ book_id: book.id, pages_read: 10, logged_at: "2026-01-10T10:00:00Z" });
    createReadingSession({ book_id: book.id, pages_read: 20, logged_at: "2026-01-11T10:00:00Z" });

    const sessions = listReadingSessions(book.id);
    expect(sessions.length).toBe(2);
  });

  test("delete reading session", () => {
    const book = createBook({ title: "Delete Session Book" });
    const session = createReadingSession({
      book_id: book.id,
      pages_read: 10,
      logged_at: "2026-01-12T10:00:00Z",
    });

    expect(deleteReadingSession(session.id)).toBe(true);
    expect(getReadingSession(session.id)).toBeNull();
  });

  test("sessions are cascade deleted with book", () => {
    const book = createBook({ title: "Cascade Session Book" });
    createReadingSession({ book_id: book.id, pages_read: 10, logged_at: "2026-01-13T10:00:00Z" });

    deleteBook(book.id);
    const sessions = listReadingSessions(book.id);
    expect(sessions.length).toBe(0);
  });
});

// ============ Stats ============

describe("Stats", () => {
  test("reading stats returns correct structure", () => {
    const stats = getReadingStats();
    expect(stats).toHaveProperty("books_read");
    expect(stats).toHaveProperty("pages_read");
    expect(stats).toHaveProperty("total_sessions");
    expect(stats).toHaveProperty("avg_rating");
    expect(stats).toHaveProperty("by_category");
    expect(typeof stats.books_read).toBe("number");
    expect(typeof stats.pages_read).toBe("number");
    expect(typeof stats.total_sessions).toBe("number");
  });

  test("reading stats with year filter", () => {
    const book = createBook({ title: "Stats Year Book", category: "Science" });
    startBook(book.id);
    finishBook(book.id, 4);

    // The book finished_at is now(), which is 2026
    const stats = getReadingStats(2026);
    expect(stats.books_read).toBeGreaterThanOrEqual(1);
  });

  test("reading pace returns correct structure", () => {
    const pace = getReadingPace();
    expect(pace).toHaveProperty("pages_per_day");
    expect(pace).toHaveProperty("books_per_month");
    expect(pace).toHaveProperty("avg_session_pages");
    expect(pace).toHaveProperty("avg_session_minutes");
    expect(typeof pace.pages_per_day).toBe("number");
  });

  test("reading stats counts completed books by category", () => {
    const book1 = createBook({ title: "Cat Book 1", category: "History" });
    const book2 = createBook({ title: "Cat Book 2", category: "History" });
    startBook(book1.id);
    finishBook(book1.id, 3);
    startBook(book2.id);
    finishBook(book2.id, 4);

    const stats = getReadingStats();
    expect(stats.by_category["History"]).toBeGreaterThanOrEqual(2);
  });
});
