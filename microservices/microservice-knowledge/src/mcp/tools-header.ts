#!/usr/bin/env bun
/**
 * MCP server for microservice-knowledge.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createCollection, listCollections, getCollection, deleteCollection } from "../lib/collections.js";
import { deleteDocument, listDocuments, getDocument, getDocumentById, getDocumentByHash, hashContent, updateDocumentMetadata } from "../lib/documents.js";
import { chunkText, estimateTokens } from "../lib/chunking.js";
import { ingestDocument, queueReindex } from "../lib/ingest.js";
import {
  computeDocumentHash,
  getStoredContentHash,
  indexDocumentIncremental,
  reindexIfChanged,
  forceReindexDocument,
} from "../lib/incremental.js";
import { retrieve } from "../lib/retrieve.js";
import { getCollectionStats } from "../lib/stats.js";
import {
  storeVisionChunk,
  getVisionChunks,
  getVisionChunkById,
  deleteVisionChunks,
} from "../lib/vision.js";
import {
  addCitation,
  getCitationsForChunk,
  getCitationsMadeByChunk,
  findCitingDocuments,
  deleteCitation,
  deleteCitationsForDocument,
} from "../lib/citations.js";
import {
  setChunkingStrategy,
  rechunkDocument,
} from "../lib/chunkingStrategies.js";
import {
  crossCollectionRetrieve,
  workspaceRetrieve,
} from "../lib/crossCollection.js";
import {
  bm25Search,
  hybridSearch,
} from "../lib/bm25.js";
import {
  compareVersions,
  createDocumentVersion,
  getDocumentVersion,
  listDocumentVersions,
  pruneOldVersions,
  restoreDocumentVersion,
} from "../lib/versioning.js";
import {
  logDocumentAccess,
  getPopularDocuments,
  getDocumentAccessFrequency,
  getHotChunks,
  touchDocument,
} from "../lib/document-access.js";
import {
  graphWalk,
  computeCollectionImportance,
  getCitingDocuments,
  getCitedDocuments,
} from "../lib/knowledge-graph.js";
import {
  shareCollection,
  revokeCollectionShare,
  listCollectionShares,
  listWorkspaceCollections,
  checkCollectionPermission,
  getCollectionAccessList,
} from "../lib/collection-permissions.js";
import {
  queueIndexingJob,
  dequeueIndexingJob,
  getIndexingJob,
  listIndexingJobs,
  processIndexingQueue,
  getIndexingQueueStats,
  cancelIndexingJob,
  completeIndexingJob,
  failIndexingJob,
  processIndexingJob,
} from "../lib/indexing-jobs.js";
import {
  setCitationProvenance,
  getCitationProvenance,
  verifyCitation,
  getProvenanceChain,
  detectCircularCitations,
  getCollectionProvenanceStats,
  listCitationsByTrust,
  retractCitation,
} from "../lib/citation-provenance.js";
import {
  processDocument,
  detectFormat,
  detectFormatFromFilename,
  extractFromHtml,
  extractFromMarkdown,
  extractFromPlainText,
  type DocumentFormat,
} from "../lib/document-processors.js";
import {
  createIndexCheckpoint,
  getLatestCheckpoint,
  computeDelta,
  listCheckpoints,
  pruneOldCheckpoints,
  getDeltaChunks,
} from "../lib/index-checkpoints.js";
import {
  enrichVisionChunk,
  getEnrichedVisionChunk,
  listUnprocessedVisionChunks,
  classifyCitationType,
  setSectionAnchor,
  getCitationsByType,
  setCitationVerifiedStatus,
} from "../lib/multimodal-enrichment.js";
import {
  logSearchQuery,
  recordSearchClicks,
  getSearchAnalytics,
  getTopQueries,
  getNoResultQueries,
} from "../lib/search-analytics.js";
import {
  findRelatedDocuments,
  findRelatedByQuery,
  getDocumentCentroid,
} from "../lib/related-docs.js";
import {
  setDocumentPriority,
  getDocumentPriority,
  getCollectionPriorities,
  clearDocumentPriority,
  pruneExpiredPriorities,
  boostScores,
} from "../lib/doc-priority.js";
import {
  detectEntityConflicts,
  scanWorkspaceConflicts,
  getConflictStats,
} from "../lib/index.js";
import {
  classifyQueryIntent,
  recordQueryIntent,
  getIntentDistribution,
  getLowConfidenceQueries,
} from "../lib/query-intent.js";

const server = new McpServer({
  name: "microservice-knowledge",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

