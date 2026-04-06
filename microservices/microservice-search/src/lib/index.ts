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

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// Embeddings
export { generateEmbedding } from "./embeddings.js";
// Indexing
export {
  deleteCollection,
  deleteDocument,
  type IndexDocumentInput,
  getDocument,
  batchIndexDocuments,
  indexDocument,
  listCollections,
  updateDocument,
} from "./index_ops.js";
// Search
export {
  countDocuments,
  facetedSearch,
  multiCollectionSearch,
  autocomplete,
  type SearchQuery,
  type SearchResult,
  type FacetedSearchResult,
  search,
  similarByEmbedding,
} from "./search_ops.js";
