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
  getDocumentByHash,
  getDocumentById,
  hashContent,
  listDocuments,
  updateDocumentMetadata,
} from "./documents.js";
// Embeddings
export { generateEmbedding, hasEmbeddingKey } from "./embeddings.js";
// Ingestion
export {
  type IngestInput,
  ingestDocument,
  processReindexQueue,
  queueReindex,
  reindexDocument,
} from "./ingest.js";
// Incremental indexing
export {
  computeDocumentHash,
  getStoredContentHash,
  indexDocumentIncremental,
  reindexIfChanged,
  forceReindexDocument,
} from "./incremental.js";
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
// Vision chunks (multi-modal)
export {
  type VisionChunk,
  type StoreVisionChunkInput,
  storeVisionChunk,
  getVisionChunks,
  getVisionChunkById,
  deleteVisionChunks,
} from "./vision.js";
// Citations
export {
  type Citation,
  type AddCitationInput,
  addCitation,
  getCitationsForChunk,
  getCitationsMadeByChunk,
  findCitingDocuments,
  deleteCitationsForDocument,
  deleteCitation,
} from "./citations.js";
// Chunking strategies
export {
  setChunkingStrategy,
  rechunkDocument,
} from "./chunkingStrategies.js";
// Cross-collection retrieval
export {
  crossCollectionRetrieve,
  workspaceRetrieve,
} from "./crossCollection.js";
// BM25 ranking
export {
  bm25Search,
  hybridSearch,
  DEFAULT_BM25_OPTIONS,
  type BM25Options,
  type BM25Chunk,
} from "./bm25.js";
// Document versioning
export {
  compareVersions,
  createDocumentVersion,
  getDocumentVersion,
  listDocumentVersions,
  pruneOldVersions,
  restoreDocumentVersion,
  type DocumentVersion,
  type CreateVersionData,
} from "./versioning.js";
// Hybrid Retrieval (semantic + BM25 + cross-encoder reranking)
export {
  type RerankedResult,
  hybridRetrieveReranked,
  blendScores,
  crossEncoderRerank,
} from "./hybrid-retrieve.js";
// Citation Graph
export {
  type CitationEdge,
  type ImpactScore,
  type CitationPathResult,
  getOutgoingCitations,
  getIncomingCitations,
  findRootSourceDocuments,
  findAllCitingDocuments,
  findCitationPath,
  computeImpactScores,
} from "./citation-graph.js";
// Document access tracking
export {
  logDocumentAccess,
  getPopularDocuments,
  getDocumentAccessFrequency,
  getHotChunks,
  touchDocument,
  type DocumentAccess,
} from "./document-access.js";
// Knowledge graph traversal
export {
  getCitingDocuments,
  getCitedDocuments,
  graphWalk,
  computeCollectionImportance,
  type GraphNode,
  type GraphEdge,
} from "./knowledge-graph.js";
// Collection permissions (cross-workspace sharing)
export {
  shareCollection,
  revokeCollectionShare,
  listCollectionShares,
  listWorkspaceCollections,
  checkCollectionPermission,
  getCollectionAccessList,
  type CollectionPermission,
  type CollectionShare,
} from "./collection-permissions.js";
// Background indexing job queue
export {
  queueIndexingJob,
  dequeueIndexingJob,
  completeIndexingJob,
  failIndexingJob,
  cancelIndexingJob,
  getIndexingJob,
  listIndexingJobs,
  processIndexingJob,
  processIndexingQueue,
  getIndexingQueueStats,
  type IndexingJob,
  type IndexingJobStatus,
  type IndexingJobPriority,
} from "./indexing-jobs.js";
// Citation provenance and trust
export {
  setCitationProvenance,
  getCitationProvenance,
  verifyCitation,
  getProvenanceChain,
  detectCircularCitations,
  getCollectionProvenanceStats,
  listCitationsByTrust,
  retractCitation,
  type CitationProvenance,
  type ProvenanceChain,
  type ProvenanceStats,
  type ProvenanceConfidence,
  type VerificationStatus,
} from "./citation-provenance.js";
// Multi-format document processing
export {
  detectFormat,
  detectFormatFromFilename,
  processDocument,
  extractFromHtml,
  extractFromMarkdown,
  extractFromPlainText,
  type DocumentFormat,
  type ProcessedDocument,
  type ContentBlock,
  type DocumentMetadata,
} from "./document-processors.js";
// Index checkpoints (incremental version tracking)
export {
  type IndexCheckpoint,
  type DeltaChunk,
  createIndexCheckpoint,
  getLatestCheckpoint,
  computeDelta,
  listCheckpoints,
  pruneOldCheckpoints,
  getDeltaChunks,
} from "./index-checkpoints.js";
// Multi-modal enrichment and citation types
export {
  type VisionEnrichment,
  type CitationType,
  type CitationWithType,
  enrichVisionChunk,
  getEnrichedVisionChunk,
  listUnprocessedVisionChunks,
  classifyCitationType,
  setSectionAnchor,
  getCitationsByType,
  setCitationVerifiedStatus,
} from "./multimodal-enrichment.js";
// Search analytics
export {
  logSearchQuery,
  recordSearchClicks,
  getSearchAnalytics,
  getTopQueries,
  getNoResultQueries,
  type SearchAnalyticsEntry,
  type SearchAnalyticsSummary,
  type TopQuery,
} from "./search-analytics.js";
// Related documents (semantic similarity via embedding centroids)
export {
  getDocumentCentroid,
  findRelatedDocuments,
  findRelatedByQuery,
  type RelatedDocument,
} from "./related-docs.js";
// Document priority boost in retrieval
export {
  setDocumentPriority,
  getDocumentPriority,
  getCollectionPriorities,
  clearDocumentPriority,
  pruneExpiredPriorities,
  boostScores,
  buildPriorityMap,
  type DocumentPriority,
  type ScoredDocument,
} from "./doc-priority.js";
// Conflict detection for contradictory facts
export {
  detectEntityConflicts,
  scanWorkspaceConflicts,
  getConflictStats,
  type ConflictReport,
  type KnowledgeConflict,
  type ConflictingValue,
} from "./conflict-detection.js";
// Query intent classification
export {
  type QueryIntent,
  type IntentCandidate,
  type IntentClassification,
  classifyQueryIntent,
  recordQueryIntent,
  getIntentDistribution,
  getLowConfidenceQueries,
} from "./query-intent.js";
