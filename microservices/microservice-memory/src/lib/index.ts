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
  type CollectionStats,
  type CreateCollectionInput,
  createCollection,
  deleteCollection,
  getCollection,
  getCollectionStats,
  listCollections,
  updateCollectionTTL,
} from "./collections.js";
// Embeddings
export { generateEmbedding, hasEmbeddingKey } from "./embeddings.js";
// Memories
export {
  deleteMemory,
  forkMemory,
  getMemory,
  getMemoryStats,
  listMemories,
  pinMemory,
  recommendMemories,
  type Memory,
  type MemoryStats,
  type MemoryType,
  type RecommendQuery,
  type SearchQuery,
  type StoreMemoryInput,
  type UpdateMemoryInput,
  searchMemories,
  storeMemory,
  unpinMemory,
  updateMemory,
  updateMemoryImportance,
} from "./memories.js";
// TTL
export {
  deleteExpiredMemories,
  deleteMemoriesByAge,
  deleteMemoriesByNamespace,
  deleteAllMemoriesInCollection,
  purgeExpiredMemories,
  refreshMemoryTTL,
  extendMemoryTTL,
  refreshTTLForHotMemory,
  getMemoryExpiryStats,
  setNamespaceDefaultTTL,
  getExpiringMemories,
} from "./ttl.js";
// Access tracks
export {
  logMemoryAccess,
  getMemoryAccessFrequency,
  getMemoryHotspots,
  evictLeastValuable,
  type AccessType,
  type MemoryAccessFrequency,
  type MemoryHotspot,
} from "./access-tracks.js";
// Workspaces
export {
  shareMemoryToWorkspace,
  listWorkspaceMemories,
  revokeWorkspaceMemoryAccess,
  getMemoryPermissions,
  type WorkspacePermission,
  type WorkspaceMemoryEntry,
  type MemoryPermissions,
} from "./workspaces.js";
// Recall
export {
  recordMemoryRecall,
  getMemoryQualityScore,
  getMemoryQualityReport,
  type RecallMethod,
  type MemoryQualityScore,
  type MemoryQualityBreakdown,
} from "./recall.js";
// Backup
export {
  exportMemorySnapshot,
  importMemorySnapshot,
  getSnapshotInfo,
  type ConflictStrategy,
  type SnapshotMetadata,
  type MemorySnapshot,
  type ImportResult,
} from "./backup.js";
// Templates
export {
  createMemoryTemplate,
  getMemoryTemplate,
  listMemoryTemplates,
  updateMemoryTemplate,
  deleteMemoryTemplate,
  renderMemoryTemplate,
  renderMemoryTemplateById,
  type MemoryTemplate,
  type CreateTemplateInput,
  type RenderedTemplate,
} from "./templates.js";
// Consolidation
export {
  consolidateEpisodicMemories,
  getConsolidationCandidates,
  type ConsolidationResult,
} from "./consolidation.js";
// Reranking
export {
  rerankMemories,
  rerankMemoriesFast,
  type RerankOptions,
  type ScoredMemory,
} from "./rerank.js";
// Memory decay rules
export {
  type DecayRule,
  type DecayModel,
  type ComputeDecayedImportanceResult,
  upsertDecayRule,
  getDecayRule,
  computeDecayedImportance,
  listDecayRules,
  deleteDecayRule,
} from "./decay-rules.js";
// Memory type configurations
export {
  type MemoryTypeConfig,
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
} from "./memory-types.js";
// Memory namespaces
export {
  type MemoryNamespace,
  type CreateNamespaceInput,
  createNamespace,
  getNamespace,
  deleteNamespace,
  listNamespaces,
  updateNamespace,
  renameNamespace,
  getNamespaceStats,
  getNamespaceAnalytics,
  searchAcrossNamespaces,
} from "./memory-namespaces.js";
// Memory links / relationships
export {
  linkMemories,
  unlinkMemories,
  getOutgoingLinks,
  getIncomingLinks,
  getAllLinksForMemory,
  traverseMemoryGraph,
  getMemoryLinkStats,
  type LinkType,
  type MemoryLink,
  type MemoryLinkWithTarget,
  type MemoryLinkWithSource,
} from "./memory-links.js";
// Collection policies
export {
  upsertCollectionPolicy,
  getCollectionPolicy,
  listCollectionPolicies,
  deleteCollectionPolicy,
  getEffectiveCollectionDefaults,
  isCollectionAtCapacity,
  type CollectionPolicy,
  type UpsertCollectionPolicyInput,
} from "./collection-policies.js";
// Consolidation policies
export {
  upsertConsolidationPolicy,
  setConsolidationPolicyEnabled,
  getConsolidationPolicy,
  listConsolidationPolicies,
  getDueConsolidationPolicies,
  deleteConsolidationPolicy,
  runConsolidationPolicy,
  getConsolidationPolicyStats,
  type ConsolidationPolicy,
  type ConsolidationTrigger,
  type ConsolidationMode,
  type UpsertConsolidationPolicyInput,
} from "./consolidation-policies.js";
// Deduplication
export {
  findDuplicateGroups,
  mergeDuplicate,
  similarityScore,
  type DuplicateGroup,
  type MergeResult,
} from "./memory-deduplication.js";
// Importance boost
export {
  boostMemory,
  decayExpiredBoosts,
  getMemoryBoost,
  type BoostType,
  type MemoryBoost,
  type BoostResult,
} from "./memory-boost.js";
// Time-range filtered recall
export {
  getMemoriesInTimeRange,
  getRecentMemories,
  getMemoriesBefore,
  getMemoryTimeline,
  type TimeRange,
  type RelativePeriod,
  type MemoryTimelineEntry,
} from "./memory-time-filter.js";
// Cross-namespace search
export {
  type CrossNamespaceSearchQuery,
  type CrossNamespaceSearchResult,
  searchCrossNamespace,
  getNamespaceMemoryCounts,
} from "./cross-namespace-search.js";
// Bulk operations
export {
  type BulkStoreInput,
  type BulkStoreResult,
  bulkStoreMemories,
  type BulkUpdateInput,
  type BulkUpdateResult,
  bulkUpdateMemories,
  type BulkDeleteResult,
  bulkDeleteMemories,
} from "./bulk-operations.js";
// Archival policies
export {
  type ArchiveTier,
  type ArchiveTrigger,
  type ArchivalPolicy,
  type CreatePolicyInput,
  type ArchivalHistoryEntry,
  type ExecuteArchivalResult,
  createArchivalPolicy,
  listArchivalPolicies,
  updateArchivalPolicy,
  deleteArchivalPolicy,
  executeArchivalPolicies,
  listArchivalHistory,
} from "./archival-policies.js";
// Tiered TTL (soft-expire + grace periods)
export {
  type SoftExpiredResult,
  applySoftExpire,
  purgeSoftExpired,
  getTtlStats,
} from "./ttl-tiered.js";
// Namespace budgets and auto-classification
export {
  type NamespaceBudget,
  type MemoryClassification,
  getNamespaceBudget,
  setNamespaceBudget,
  refreshNamespaceCount,
  enforceNamespaceQuota,
  classifyMemory,
  listMemoryClassifications,
} from "./namespace-quota.js";
// TTL sweeper coordinator and background enforcement
export {
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
} from "./ttl-coordinator.js";
// Namespace isolation and hard quota access controls
export {
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
} from "./namespace-isolation.js";
// Memory type specific queries (episodic/semantic/procedural/context)
export {
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
} from "./memory-type-queries.js";
// Memory versioning
export {
  type MemoryVersion,
  type CreateVersionOptions,
  createMemoryVersion,
  getMemoryVersions,
  getMemoryVersion,
  restoreMemoryVersion,
  compareMemoryVersions,
  getMemoryVersionCount,
  pruneMemoryVersions,
} from "./memory-versioning.js";
// Memory importance auto-tuning
export {
  type ImportanceSuggestion,
  type TuningReport,
  analyzeImportanceTuning,
  applyImportanceTuning,
  getMostImprovedMemories,
} from "./memory-importance-tuning.js";
// Memory analytics
export {
  type MemoryTrends,
  type AccessHeatmap,
  type MemoryHealthScore,
  getMemoryTrends,
  getAccessHeatmap,
  computeMemoryHealthScore,
  getMemoryTypeTrend,
} from "./memory-analytics.js";
// Memory handoff — agent context transfer
export {
  generateMemoryHandoffSummary,
  transferMemoryContext,
  scoreMemoriesByTopicRelevance,
  getPrioritizedMemoriesForAgent,
  type MemoryHandoffSummary,
  type HandoffMemory,
  type CrossAgentContext,
  type MemoryRelevanceScore,
} from "./memory-handoff.js";
// Memory version diff — compare two versions of a memory
export {
  type DiffMemoryVersion as MemoryVersionDiffEntry,
  type MemoryVersionDiff,
  type MemoryVersionList,
  getVersionDiff,
  listVersionDiffs,
  diffMemoryVersions,
  diffMemoryVersionConsecutive,
  getMemoryVersionTimeline,
} from "./memory-version-diff.js";
// Recall analytics — memory access patterns and effectiveness
export {
  type RecallEvent,
  type RecallStats,
  type MemoryRecallPopularity,
  type RecallTrendPoint,
  type RecallMiss,
  recordRecall,
  getRecallStats,
  getMemoryRecallPopularity,
  getRecallTrend,
  findRecallMismatches,
  recordRecallMiss,
  getRecallMissPatterns,
  getRecallHeatmap,
} from "./recall-analytics.js";
// TTL escalation — auto-extend TTL for high-value memories before expiry
export {
  type TTLEscalationResult,
  type TTLEscalationPolicy,
  getEscalationCandidates,
  escalateMemories,
  getEscalationStats,
  setEscalationPolicy,
  getEscalationPolicy,
} from "./ttl-escalation.js";
// Namespace transfer — move or copy memories between namespaces
export {
  type TransferOptions,
  type TransferResult,
  type MemoryTransferPreview,
  previewTransfer,
  transferMemories,
  consolidateEpisodicToSemantic,
} from "./namespace-transfer.js";
// Memory-type recall strategies — type-specific retrieval scoring
export {
  type MemoryType,
  type RecallStrategy,
  type ScoredMemory,
  type RecallOptions,
  DEFAULT_STRATEGIES,
  recallWithStrategies,
  getRecallBreakdown,
} from "./memory-type-recall-strategies.js";
