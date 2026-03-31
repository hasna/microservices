/**
 * @hasna/microservice-memory — semantic memory library.
 *
 * Usage in your app:
 *   import { migrate, storeMemory, searchMemories } from '@hasna/microservice-memory'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   await storeMemory(sql, { workspaceId: 'ws-1', content: 'The user likes TypeScript' })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Memories
export {
  storeMemory,
  searchMemories,
  getMemory,
  listMemories,
  deleteMemory,
  updateMemoryImportance,
  type Memory,
  type StoreMemoryInput,
  type SearchQuery,
} from "./memories.js";

// Collections
export {
  createCollection,
  getCollection,
  listCollections,
  deleteCollection,
  type Collection,
  type CreateCollectionInput,
} from "./collections.js";

// Embeddings
export { generateEmbedding, hasEmbeddingKey } from "./embeddings.js";
