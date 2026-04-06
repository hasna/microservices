/**
 * @hasna/microservice-files — file storage library.
 *
 * Usage in your app:
 *   import { migrate, createFileRecord, listFiles, upload } from '@hasna/microservice-files'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const file = await createFileRecord(sql, { ... })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";

// File records
export {
  bulkSoftDelete,
  countFiles,
  createFileRecord,
  type FileRecord,
  findDuplicates,
  getFile,
  getFileContent,
  getStorageStats,
  hardDeleteFile,
  listFiles,
  moveFile,
  renameFile,
  softDeleteFile,
  updateFile,
  uploadFromUrl,
} from "./files.js";

// Folders
export {
  buildPath,
  createFolder,
  deleteFolder,
  type Folder,
  getFolder,
  listFolders,
} from "./folders.js";

// Storage
export {
  deleteFile,
  deleteFromLocal,
  deleteFromS3,
  getLocalUrl,
  getMimeType,
  getPresignedUrl,
  getStorageBackend,
  getUrl,
  readFromLocal,
  type StorageBackend,
  upload,
  uploadToLocal,
  uploadToS3,
} from "./storage.js";

// Analytics
export {
  type TypeDistribution,
  type StorageQuota,
  getTypeDistribution,
  searchFiles,
  getStorageQuota,
  getLargestFiles,
  getFileActivityTimeline,
} from "./analytics.js";
