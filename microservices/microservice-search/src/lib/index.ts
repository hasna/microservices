/**
 * @hasna/microservice-search — embed-first search library.
 *
 * Usage in your app:
 *   import { migrate, indexDocument, search } from '@hasna/microservice-search'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   await indexDocument(sql, { collection: 'docs', docId: '1', content: 'Hello world' })
 *   const results = await search(sql, { text: 'hello', collection: 'docs' })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Indexing
export {
  indexDocument,
  deleteDocument,
  deleteCollection,
  listCollections,
  type IndexDocumentInput,
} from "./index_ops.js";

// Search
export {
  search,
  countDocuments,
  type SearchResult,
  type SearchQuery,
} from "./search_ops.js";

// Embeddings
export { generateEmbedding } from "./embeddings.js";
