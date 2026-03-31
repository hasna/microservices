/**
 * @hasna/microservice-knowledge — RAG knowledge base library.
 *
 * Usage in your app:
 *   import { migrate, ingestDocument, retrieve } from '@hasna/microservice-knowledge'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   await ingestDocument(sql, collectionId, { title: 'Doc', content: '...' })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Collections
export {
  createCollection,
  getCollection,
  listCollections,
  deleteCollection,
  type Collection,
  type CreateCollectionInput,
} from "./collections.js";

// Documents
export {
  getDocument,
  listDocuments,
  deleteDocument,
  hashContent,
  type Document,
} from "./documents.js";

// Chunking
export {
  chunkText,
  estimateTokens,
  type ChunkingStrategy,
  type ChunkOptions,
} from "./chunking.js";

// Ingestion
export {
  ingestDocument,
  type IngestInput,
} from "./ingest.js";

// Retrieval
export {
  retrieve,
  type RetrieveOptions,
  type RetrievedChunk,
} from "./retrieve.js";

// Stats
export {
  getCollectionStats,
  type CollectionStats,
} from "./stats.js";

// Embeddings
export { generateEmbedding, hasEmbeddingKey } from "./embeddings.js";
