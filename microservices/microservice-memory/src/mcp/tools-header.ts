#!/usr/bin/env bun
/**
 * MCP server for microservice-memory.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createCollection, listCollections, getCollection, deleteCollection, getCollectionStats } from "../lib/collections.js";
import { generateEmbedding, hasEmbeddingKey } from "../lib/embeddings.js";
import {
  deleteMemory,
  forkMemory,
  getMemory,
  getMemoryStats,
  listMemories,
  pinMemory,
  recommendMemories,
  searchMemories,
  storeMemory,
  unpinMemory,
  updateMemory,
  updateMemoryImportance,
} from "../lib/memories.js";
import {
  deleteExpiredMemories,
  deleteMemoriesByAge,
  deleteMemoriesByNamespace,
  deleteAllMemoriesInCollection,
  purgeExpiredMemories,
  getMemoryExpiryStats,
  setNamespaceDefaultTTL,
  getExpiringMemories,
  extendMemoryTTL,
  refreshMemoryTTL,
  refreshTTLForHotMemory,
  logMemoryAccess,
  getMemoryAccessFrequency,
  getMemoryHotspots,
  evictLeastValuable,
  shareMemoryToWorkspace,
  listWorkspaceMemories,
  revokeWorkspaceMemoryAccess,
  getMemoryPermissions,
  recordMemoryRecall,
  getMemoryQualityScore,
  getMemoryQualityReport,
  exportMemorySnapshot,
  importMemorySnapshot,
  getSnapshotInfo,
  createMemoryTemplate,
  getMemoryTemplate,
  listMemoryTemplates,
  updateMemoryTemplate,
  deleteMemoryTemplate,
  renderMemoryTemplate,
  renderMemoryTemplateById,
  consolidateEpisodicMemories,
  getConsolidationCandidates,
  rerankMemories,
  rerankMemoriesFast,
  linkMemories,
  unlinkMemories,
  getOutgoingLinks,
  getIncomingLinks,
  getAllLinksForMemory,
  traverseMemoryGraph,
  getMemoryLinkStats,
  upsertCollectionPolicy,
  getCollectionPolicy,
  listCollectionPolicies,
  deleteCollectionPolicy,
  getEffectiveCollectionDefaults,
  isCollectionAtCapacity,
  upsertConsolidationPolicy,
  setConsolidationPolicyEnabled,
  getConsolidationPolicy,
  listConsolidationPolicies,
  getDueConsolidationPolicies,
  deleteConsolidationPolicy,
  runConsolidationPolicy,
  getConsolidationPolicyStats,
  findDuplicateGroups,
  mergeDuplicate,
  boostMemory,
  decayExpiredBoosts,
  getMemoryBoost,
  getMemoriesInTimeRange,
  getRecentMemories,
  getMemoriesBefore,
  getMemoryTimeline,
} from "../lib/index.js";
import {
  searchCrossNamespace,
  getNamespaceMemoryCounts,
  bulkStoreMemories,
  bulkUpdateMemories,
  bulkDeleteMemories,
  createArchivalPolicy,
  listArchivalPolicies,
  updateArchivalPolicy,
  deleteArchivalPolicy,
  executeArchivalPolicies,
  listArchivalHistory,
  getMemoriesInTimeRange,
  getRecentMemories,
  getMemoriesBefore,
  getMemoryTimeline,
} from "../lib/index.js";

import {
  upsertDecayRule,
  getDecayRule,
  computeDecayedImportance,
  listDecayRules,
  deleteDecayRule,
} from "../lib/decay-rules.js";
import {
  getMemoryTypeConfig,
  setMemoryTypeConfig,
  listMemoryTypeConfigs,
  deleteMemoryTypeConfig,
  getMemoryTypeBreakdown,
  getMemoriesByType,
  setMemoryExpiry,
  clearMemoryExpiry,
  getTTLStats,
  suggestMemoryType,
  migrateMemoryType,
} from "../lib/memory-types.js";
import {
  type TtlSweeperStats,
  type TtlTierPolicy,
  startTtlSweeper,
  stopTtlSweeper,
  getTtlSweeperStats,
  runSweep,
  runWorkspaceSweep,
  enforceTtlTier,
  enforceAllTtlTiers,
  evictByAge,
} from "../lib/ttl-coordinator.js";
import {
  type NamespaceQuota,
  type NamespaceAccessPolicy,
  type NamespaceWithQuota,
  canWriteToNamespace,
  canReadFromNamespace,
  getNamespaceQuota,
  enforceNamespaceHardQuota,
  setNamespaceQuota,
  setNamespaceAccessPolicy,
  listNamespacesWithQuota,
  deleteNamespaceMemories,
} from "../lib/namespace-isolation.js";
import {
  type MemoryType,
  type TypedMemory,
  queryEpisodicMemories,
  querySemanticMemories,
  queryProceduralMemories,
  queryContextMemories,
  queryTypedMemories,
  getMemoryTypeDistribution,
  countMemoriesByType,
  archiveMemoriesByType,
} from "../lib/memory-type-queries.js";
import {
  createNamespace,
  getNamespace,
  deleteNamespace,
  listNamespaces,
  updateNamespace,
  renameNamespace,
  getNamespaceStats,
  getNamespaceAnalytics,
  searchAcrossNamespaces,
} from "../lib/memory-namespaces.js";
import {
  applySoftExpire,
  purgeSoftExpired,
  getTtlStats,
} from "../lib/ttl-tiered.js";
import {
  getNamespaceBudget,
  setNamespaceBudget,
  refreshNamespaceCount,
  enforceNamespaceQuota,
  classifyMemory,
  listMemoryClassifications,
} from "../lib/namespace-quota.js";
import {
  generateMemoryHandoffSummary,
  transferMemoryContext,
  scoreMemoriesByTopicRelevance,
  getPrioritizedMemoriesForAgent,
  getVersionDiff,
  listVersionDiffs,
  diffMemoryVersions,
  diffMemoryVersionConsecutive,
  getMemoryVersionTimeline,
  recordRecall,
  getRecallStats,
  getMemoryRecallPopularity,
  getRecallTrend,
  findRecallMismatches,
  recordRecallMiss,
  getRecallMissPatterns,
  getRecallHeatmap,
} from "../lib/index.js";

const MemoryTypeEnum = z.enum(["episodic", "semantic", "procedural", "context"]);

const server = new McpServer({
  name: "microservice-memory",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

