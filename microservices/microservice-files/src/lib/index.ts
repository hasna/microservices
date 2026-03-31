/**
 * @hasna/microservice-files — file storage library.
 *
 * Usage in your app:
 *   import { migrate, createFileRecord, listFiles, upload } from '@hasna/microservice-files'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const file = await createFileRecord(sql, { ... })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// File records
export {
  createFileRecord,
  getFile,
  listFiles,
  updateFile,
  softDeleteFile,
  hardDeleteFile,
  countFiles,
  type FileRecord,
} from "./files.js";

// Folders
export {
  createFolder,
  getFolder,
  listFolders,
  deleteFolder,
  buildPath,
  type Folder,
} from "./folders.js";

// Storage
export {
  getStorageBackend,
  getMimeType,
  upload,
  getUrl,
  deleteFile,
  uploadToS3,
  getPresignedUrl,
  deleteFromS3,
  uploadToLocal,
  getLocalUrl,
  deleteFromLocal,
  readFromLocal,
  type StorageBackend,
} from "./storage.js";
