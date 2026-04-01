/**
 * @hasna/microservice-memory — semantic memory library.
 *
 * Usage in your app:
 *   import { migrate, storeMemory, searchMemories } from '@hasna/microservice-memory'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   await storeMemory(sql, { workspaceId: 'ws-1', content: 'The user likes TypeScript' })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// Collections
export {
  type Collection,
  type CreateCollectionInput,
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
} from "./collections.js";
// Embeddings
export { generateEmbedding, hasEmbeddingKey } from "./embeddings.js";
// Memories
export {
  deleteMemory,
  getMemory,
  listMemories,
  type Memory,
  type SearchQuery,
  type StoreMemoryInput,
  searchMemories,
  storeMemory,
  updateMemoryImportance,
} from "./memories.js";
