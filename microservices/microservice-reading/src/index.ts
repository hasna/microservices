/**
 * microservice-reading — Reading tracker microservice
 */

export {
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
  type Book,
  type CreateBookInput,
  type UpdateBookInput,
  type ListBooksOptions,
  type BookProgress,
} from "./db/reading.js";

export {
  createHighlight,
  getHighlight,
  listHighlights,
  deleteHighlight,
  searchHighlights,
  type Highlight,
  type CreateHighlightInput,
} from "./db/reading.js";

export {
  createReadingSession,
  getReadingSession,
  listReadingSessions,
  deleteReadingSession,
  type ReadingSession,
  type CreateReadingSessionInput,
} from "./db/reading.js";

export {
  getReadingStats,
  getReadingPace,
  type ReadingStats,
  type ReadingPace,
} from "./db/reading.js";

export { getDatabase, closeDatabase } from "./db/database.js";
