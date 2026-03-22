#!/usr/bin/env bun

import { Command } from "commander";
import {
  createBook,
  getBook,
  listBooks,
  updateBook,
  deleteBook,
  searchBooks,
  startBook,
  finishBook,
  abandonBook,
  getCurrentlyReading,
  getBookProgress,
  getReadingStats,
  getReadingPace,
} from "../db/reading.js";
import {
  createHighlight,
  listHighlights,
  searchHighlights,
} from "../db/reading.js";
import {
  createReadingSession,
  listReadingSessions,
} from "../db/reading.js";

const program = new Command();

program
  .name("microservice-reading")
  .description("Reading tracker microservice")
  .version("0.0.1");

// --- Books ---

const bookCmd = program
  .command("book")
  .description("Book management");

bookCmd
  .command("add")
  .description("Add a new book")
  .requiredOption("--title <title>", "Book title")
  .option("--author <author>", "Author name")
  .option("--isbn <isbn>", "ISBN")
  .option("--category <category>", "Category/genre")
  .option("--pages <pages>", "Total pages")
  .option("--cover-url <url>", "Cover image URL")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const book = createBook({
      title: opts.title,
      author: opts.author,
      isbn: opts.isbn,
      category: opts.category,
      pages: opts.pages ? parseInt(opts.pages) : undefined,
      cover_url: opts.coverUrl,
    });

    if (opts.json) {
      console.log(JSON.stringify(book, null, 2));
    } else {
      console.log(`Added book: ${book.title}${book.author ? ` by ${book.author}` : ""} (${book.id})`);
    }
  });

bookCmd
  .command("list")
  .description("List books")
  .option("--status <status>", "Filter by status (to_read, reading, completed, abandoned)")
  .option("--category <category>", "Filter by category")
  .option("--author <author>", "Filter by author")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const books = listBooks({
      status: opts.status,
      category: opts.category,
      author: opts.author,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(books, null, 2));
    } else {
      if (books.length === 0) {
        console.log("No books found.");
        return;
      }
      for (const b of books) {
        const author = b.author ? ` by ${b.author}` : "";
        const status = ` [${b.status}]`;
        const progress = b.pages ? ` (${b.current_page}/${b.pages})` : "";
        console.log(`  ${b.title}${author}${status}${progress}`);
      }
      console.log(`\n${books.length} book(s)`);
    }
  });

bookCmd
  .command("get")
  .description("Get a book by ID")
  .argument("<id>", "Book ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const book = getBook(id);
    if (!book) {
      console.error(`Book '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(book, null, 2));
    } else {
      console.log(`${book.title}`);
      if (book.author) console.log(`  Author: ${book.author}`);
      if (book.isbn) console.log(`  ISBN: ${book.isbn}`);
      console.log(`  Status: ${book.status}`);
      if (book.pages) console.log(`  Progress: ${book.current_page}/${book.pages} pages`);
      if (book.rating) console.log(`  Rating: ${book.rating}/5`);
      if (book.category) console.log(`  Category: ${book.category}`);
      if (book.started_at) console.log(`  Started: ${book.started_at}`);
      if (book.finished_at) console.log(`  Finished: ${book.finished_at}`);
    }
  });

bookCmd
  .command("update")
  .description("Update a book")
  .argument("<id>", "Book ID")
  .option("--title <title>", "Title")
  .option("--author <author>", "Author")
  .option("--isbn <isbn>", "ISBN")
  .option("--category <category>", "Category")
  .option("--pages <pages>", "Total pages")
  .option("--current-page <page>", "Current page")
  .option("--rating <rating>", "Rating (1-5)")
  .option("--cover-url <url>", "Cover URL")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.author !== undefined) input.author = opts.author;
    if (opts.isbn !== undefined) input.isbn = opts.isbn;
    if (opts.category !== undefined) input.category = opts.category;
    if (opts.pages !== undefined) input.pages = parseInt(opts.pages);
    if (opts.currentPage !== undefined) input.current_page = parseInt(opts.currentPage);
    if (opts.rating !== undefined) input.rating = parseInt(opts.rating);
    if (opts.coverUrl !== undefined) input.cover_url = opts.coverUrl;

    const book = updateBook(id, input);
    if (!book) {
      console.error(`Book '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(book, null, 2));
    } else {
      console.log(`Updated: ${book.title}`);
    }
  });

bookCmd
  .command("delete")
  .description("Delete a book")
  .argument("<id>", "Book ID")
  .action((id) => {
    const deleted = deleteBook(id);
    if (deleted) {
      console.log(`Deleted book ${id}`);
    } else {
      console.error(`Book '${id}' not found.`);
      process.exit(1);
    }
  });

bookCmd
  .command("search")
  .description("Search books")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchBooks(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No books matching "${query}".`);
        return;
      }
      for (const b of results) {
        console.log(`  ${b.title}${b.author ? ` by ${b.author}` : ""} [${b.status}]`);
      }
    }
  });

bookCmd
  .command("start")
  .description("Start reading a book")
  .argument("<id>", "Book ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const book = startBook(id);
    if (!book) {
      console.error(`Book '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(book, null, 2));
    } else {
      console.log(`Started reading: ${book.title}`);
    }
  });

bookCmd
  .command("finish")
  .description("Mark a book as finished")
  .argument("<id>", "Book ID")
  .option("--rating <rating>", "Rating (1-5)")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const rating = opts.rating ? parseInt(opts.rating) : undefined;
    const book = finishBook(id, rating);
    if (!book) {
      console.error(`Book '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(book, null, 2));
    } else {
      console.log(`Finished: ${book.title}${rating ? ` (rated ${rating}/5)` : ""}`);
    }
  });

bookCmd
  .command("abandon")
  .description("Abandon a book")
  .argument("<id>", "Book ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const book = abandonBook(id);
    if (!book) {
      console.error(`Book '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(book, null, 2));
    } else {
      console.log(`Abandoned: ${book.title}`);
    }
  });

// --- Highlights ---

const highlightCmd = program
  .command("highlight")
  .description("Highlight management");

highlightCmd
  .command("add")
  .description("Add a highlight to a book")
  .requiredOption("--book <id>", "Book ID")
  .requiredOption("--text <text>", "Highlight text")
  .option("--page <page>", "Page number")
  .option("--chapter <chapter>", "Chapter name")
  .option("--color <color>", "Highlight color", "yellow")
  .option("--notes <notes>", "Notes about the highlight")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const highlight = createHighlight({
      book_id: opts.book,
      text: opts.text,
      page: opts.page ? parseInt(opts.page) : undefined,
      chapter: opts.chapter,
      color: opts.color,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(highlight, null, 2));
    } else {
      console.log(`Added highlight (${highlight.id})`);
    }
  });

highlightCmd
  .command("list")
  .description("List highlights for a book")
  .argument("<book-id>", "Book ID")
  .option("--json", "Output as JSON", false)
  .action((bookId, opts) => {
    const highlights = listHighlights(bookId);

    if (opts.json) {
      console.log(JSON.stringify(highlights, null, 2));
    } else {
      if (highlights.length === 0) {
        console.log("No highlights found.");
        return;
      }
      for (const h of highlights) {
        const page = h.page ? ` (p.${h.page})` : "";
        const chapter = h.chapter ? ` [${h.chapter}]` : "";
        console.log(`  "${h.text}"${page}${chapter}`);
        if (h.notes) console.log(`    Note: ${h.notes}`);
      }
      console.log(`\n${highlights.length} highlight(s)`);
    }
  });

highlightCmd
  .command("search")
  .description("Search all highlights")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchHighlights(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No highlights matching "${query}".`);
        return;
      }
      for (const h of results) {
        console.log(`  "${h.text}" — ${h.book_title}`);
        if (h.notes) console.log(`    Note: ${h.notes}`);
      }
    }
  });

// --- Sessions ---

const sessionCmd = program
  .command("session")
  .description("Reading session management");

sessionCmd
  .command("log")
  .description("Log a reading session")
  .requiredOption("--book <id>", "Book ID")
  .option("--pages <pages>", "Pages read")
  .option("--duration <minutes>", "Duration in minutes")
  .option("--date <date>", "Date (ISO string)", new Date().toISOString())
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const session = createReadingSession({
      book_id: opts.book,
      pages_read: opts.pages ? parseInt(opts.pages) : undefined,
      duration_min: opts.duration ? parseInt(opts.duration) : undefined,
      logged_at: opts.date,
    });

    if (opts.json) {
      console.log(JSON.stringify(session, null, 2));
    } else {
      const pages = session.pages_read ? `${session.pages_read} pages` : "";
      const duration = session.duration_min ? `${session.duration_min} min` : "";
      const parts = [pages, duration].filter(Boolean).join(", ");
      console.log(`Logged session: ${parts || "no details"} (${session.id})`);
    }
  });

sessionCmd
  .command("list")
  .description("List reading sessions for a book")
  .argument("<book-id>", "Book ID")
  .option("--json", "Output as JSON", false)
  .action((bookId, opts) => {
    const sessions = listReadingSessions(bookId);

    if (opts.json) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      if (sessions.length === 0) {
        console.log("No sessions found.");
        return;
      }
      for (const s of sessions) {
        const pages = s.pages_read ? `${s.pages_read} pages` : "";
        const duration = s.duration_min ? `${s.duration_min} min` : "";
        const parts = [pages, duration].filter(Boolean).join(", ");
        console.log(`  ${s.logged_at}: ${parts || "no details"}`);
      }
      console.log(`\n${sessions.length} session(s)`);
    }
  });

// --- Top-level convenience commands ---

program
  .command("stats")
  .description("Show reading statistics")
  .option("--year <year>", "Filter by year")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const year = opts.year ? parseInt(opts.year) : undefined;
    const stats = getReadingStats(year);

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Reading Stats${year ? ` (${year})` : ""}:`);
      console.log(`  Books read: ${stats.books_read}`);
      console.log(`  Pages read: ${stats.pages_read}`);
      console.log(`  Total sessions: ${stats.total_sessions}`);
      console.log(`  Avg rating: ${stats.avg_rating ?? "N/A"}`);
      if (Object.keys(stats.by_category).length > 0) {
        console.log("  By category:");
        for (const [cat, count] of Object.entries(stats.by_category)) {
          console.log(`    ${cat}: ${count}`);
        }
      }
    }
  });

program
  .command("currently-reading")
  .description("Show books currently being read")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const books = getCurrentlyReading();

    if (opts.json) {
      console.log(JSON.stringify(books, null, 2));
    } else {
      if (books.length === 0) {
        console.log("Not reading any books right now.");
        return;
      }
      for (const b of books) {
        const progress = b.pages ? ` (${b.current_page}/${b.pages} pages)` : "";
        console.log(`  ${b.title}${b.author ? ` by ${b.author}` : ""}${progress}`);
      }
    }
  });

program
  .command("pace")
  .description("Show reading pace")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const pace = getReadingPace();

    if (opts.json) {
      console.log(JSON.stringify(pace, null, 2));
    } else {
      console.log("Reading Pace:");
      console.log(`  Pages/day: ${pace.pages_per_day}`);
      console.log(`  Books/month: ${pace.books_per_month}`);
      console.log(`  Avg pages/session: ${pace.avg_session_pages}`);
      console.log(`  Avg minutes/session: ${pace.avg_session_minutes ?? "N/A"}`);
    }
  });

program.parse(process.argv);
