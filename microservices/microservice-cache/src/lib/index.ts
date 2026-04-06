export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
export {
  type CacheEntry,
  set,
  get,
  del,
  exists,
  clear,
  keys,
  getOrSet,
  increment,
  decrement,
  touch,
  type SetOptions,
} from "./cache.js";
export {
  createNamespace,
  getNamespace,
  listNamespaces,
  deleteNamespace,
} from "./namespaces.js";
export {
  setMany,
  getMany,
  delMany,
  touchMany,
  type BatchEntry,
} from "./batch.js";
export {
  getNamespaceStats,
  getTopKeys,
  type NamespaceStats,
} from "./stats.js";
