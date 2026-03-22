/**
 * microservice-assets — Digital asset management microservice
 */

export {
  createAsset,
  getAsset,
  listAssets,
  updateAsset,
  deleteAsset,
  searchAssets,
  listByType,
  listByTag,
  listByCategory,
  getAssetStats,
  createCollection,
  getCollection,
  listCollections,
  deleteCollection,
  addToCollection,
  removeFromCollection,
  getCollectionAssets,
  type Asset,
  type CreateAssetInput,
  type UpdateAssetInput,
  type ListAssetsOptions,
  type AssetStats,
  type Collection,
  type CreateCollectionInput,
} from "./db/assets.js";

export { getDatabase, closeDatabase } from "./db/database.js";
