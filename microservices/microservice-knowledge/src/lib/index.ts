/**
 * @hasna/microservice-knowledge — RAG knowledge base library.
 *
 * Usage in your app:
 *   import { migrate, ingestDocument, retrieve } from '@hasna/microservice-knowledge'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   await ingestDocument(sql, collectionId, { title: 'Doc', content: '...' })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// Chunking
export {
  type ChunkingStrategy,
  type ChunkOptions,
  chunkText,
  estimateTokens,
} from "./chunking.js";
// Collections
export {
  type Collection,
  type CreateCollectionInput,
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
} from "./collections.js";
// Documents
export {
  type Document,
  deleteDocument,
  getDocument,
  hashContent,
  listDocuments,
} from "./documents.js";
// Embeddings
export { generateEmbedding, hasEmbeddingKey } from "./embeddings.js";
// Ingestion
export {
  type IngestInput,
  ingestDocument,
} from "./ingest.js";
// Retrieval
export {
  type RetrievedChunk,
  type RetrieveOptions,
  retrieve,
} from "./retrieve.js";
// Stats
export {
  type CollectionStats,
  getCollectionStats,
} from "./stats.js";
