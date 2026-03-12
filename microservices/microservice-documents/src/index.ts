/**
 * microservice-documents — Document management microservice
 */

export {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
  deleteDocument,
  countDocuments,
  searchDocuments,
  getDocumentsByTag,
  addVersion,
  listVersions,
  type Document,
  type DocumentVersion,
  type CreateDocumentInput,
  type UpdateDocumentInput,
  type ListDocumentsOptions,
  type AddVersionInput,
} from "./db/documents.js";

export { getDatabase, closeDatabase } from "./db/database.js";
