#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
  createHighlight,
  listHighlights,
  searchHighlights,
  deleteHighlight,
  createReadingSession,
  listReadingSessions,
} from "../db/reading.js";

const server = new McpServer({
  name: "microservice-reading",
  version: "0.0.1",
});

// --- Books ---

server.registerTool(
  "create_book",
  {
    title: "Create Book",
    description: "Add a new book to your reading list.",
    inputSchema: {
      title: z.string(),
      author: z.string().optional(),
      isbn: z.string().optional(),
      category: z.string().optional(),
      pages: z.number().optional(),
      cover_url: z.string().optional(),
    },
  },
  async (params) => {
    const book = createBook(params);
    return { content: [{ type: "text", text: JSON.stringify(book, null, 2) }] };
  }
);

server.registerTool(
  "get_book",
  {
    title: "Get Book",
    description: "Get a book by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const book = getBook(id);
    if (!book) {
      return { content: [{ type: "text", text: `Book '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(book, null, 2) }] };
  }
);

server.registerTool(
  "list_books",
  {
    title: "List Books",
    description: "List books with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      status: z.string().optional(),
      category: z.string().optional(),
      author: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const books = listBooks(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ books, count: books.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_book",
  {
    title: "Update Book",
    description: "Update an existing book.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      author: z.string().optional(),
      isbn: z.string().optional(),
      category: z.string().optional(),
      pages: z.number().optional(),
      current_page: z.number().optional(),
      rating: z.number().optional(),
      cover_url: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const book = updateBook(id, input);
    if (!book) {
      return { content: [{ type: "text", text: `Book '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(book, null, 2) }] };
  }
);

server.registerTool(
  "delete_book",
  {
    title: "Delete Book",
    description: "Delete a book by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteBook(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_books",
  {
    title: "Search Books",
    description: "Search books by title, author, ISBN, or category.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchBooks(query);
    return {
      content: [{ type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "start_book",
  {
    title: "Start Book",
    description: "Mark a book as currently reading.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const book = startBook(id);
    if (!book) {
      return { content: [{ type: "text", text: `Book '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(book, null, 2) }] };
  }
);

server.registerTool(
  "finish_book",
  {
    title: "Finish Book",
    description: "Mark a book as completed.",
    inputSchema: {
      id: z.string(),
      rating: z.number().optional(),
    },
  },
  async ({ id, rating }) => {
    const book = finishBook(id, rating);
    if (!book) {
      return { content: [{ type: "text", text: `Book '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(book, null, 2) }] };
  }
);

server.registerTool(
  "abandon_book",
  {
    title: "Abandon Book",
    description: "Mark a book as abandoned.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const book = abandonBook(id);
    if (!book) {
      return { content: [{ type: "text", text: `Book '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(book, null, 2) }] };
  }
);

server.registerTool(
  "currently_reading",
  {
    title: "Currently Reading",
    description: "Get all books currently being read.",
    inputSchema: {},
  },
  async () => {
    const books = getCurrentlyReading();
    return {
      content: [{ type: "text", text: JSON.stringify({ books, count: books.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "book_progress",
  {
    title: "Book Progress",
    description: "Get reading progress for a book (current page, total pages, percentage).",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const progress = getBookProgress(id);
    if (!progress) {
      return { content: [{ type: "text", text: `Book '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(progress, null, 2) }] };
  }
);

// --- Highlights ---

server.registerTool(
  "create_highlight",
  {
    title: "Create Highlight",
    description: "Add a highlight to a book.",
    inputSchema: {
      book_id: z.string(),
      text: z.string(),
      page: z.number().optional(),
      chapter: z.string().optional(),
      color: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const highlight = createHighlight(params);
    return { content: [{ type: "text", text: JSON.stringify(highlight, null, 2) }] };
  }
);

server.registerTool(
  "list_highlights",
  {
    title: "List Highlights",
    description: "List all highlights for a book.",
    inputSchema: { book_id: z.string() },
  },
  async ({ book_id }) => {
    const highlights = listHighlights(book_id);
    return {
      content: [{ type: "text", text: JSON.stringify({ highlights, count: highlights.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "search_highlights",
  {
    title: "Search Highlights",
    description: "Search highlights across all books.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchHighlights(query);
    return {
      content: [{ type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "delete_highlight",
  {
    title: "Delete Highlight",
    description: "Delete a highlight by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteHighlight(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Reading Sessions ---

server.registerTool(
  "log_reading_session",
  {
    title: "Log Reading Session",
    description: "Log a reading session for a book.",
    inputSchema: {
      book_id: z.string(),
      pages_read: z.number().optional(),
      duration_min: z.number().optional(),
      logged_at: z.string(),
    },
  },
  async (params) => {
    const session = createReadingSession(params);
    return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
  }
);

server.registerTool(
  "list_reading_sessions",
  {
    title: "List Reading Sessions",
    description: "List reading sessions for a book.",
    inputSchema: { book_id: z.string() },
  },
  async ({ book_id }) => {
    const sessions = listReadingSessions(book_id);
    return {
      content: [{ type: "text", text: JSON.stringify({ sessions, count: sessions.length }, null, 2) }],
    };
  }
);

// --- Stats ---

server.registerTool(
  "reading_stats",
  {
    title: "Reading Stats",
    description: "Get reading statistics (books read, pages read, sessions, avg rating, by category).",
    inputSchema: {
      year: z.number().optional(),
    },
  },
  async ({ year }) => {
    const stats = getReadingStats(year);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.registerTool(
  "reading_pace",
  {
    title: "Reading Pace",
    description: "Get reading pace (pages/day, books/month, session averages).",
    inputSchema: {},
  },
  async () => {
    const pace = getReadingPace();
    return { content: [{ type: "text", text: JSON.stringify(pace, null, 2) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-reading MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
