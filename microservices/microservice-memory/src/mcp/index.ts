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

// --- Access frequency & hotspots ---

server.tool(
  "memory_log_access",
  "Log a memory access event for frequency tracking",
  {
    memory_id: z.string(),
    access_type: z.enum(["read", "write", "search"]),
    response_time_ms: z.number().optional(),
  },
  async ({ memory_id, access_type, response_time_ms }) => {
    await logMemoryAccess(sql, memory_id, access_type, response_time_ms);
    return text({ ok: true });
  },
);

server.tool(
  "memory_get_access_frequency",
  "Get access frequency analysis for memories in a namespace",
  {
    namespace: z.string(),
    hours: z.number().optional().default(24),
  },
  async ({ namespace, hours }) =>
    text(await getMemoryAccessFrequency(sql, namespace, hours)),
);

server.tool(
  "memory_hotspots",
  "Get most frequently accessed memories (hotspots) in a namespace",
  {
    namespace: z.string(),
    limit: z.number().optional().default(10),
  },
  async ({ namespace, limit }) => text(await getMemoryHotspots(sql, namespace, limit)),
);

server.tool(
  "memory_evict_least_valuable",
  "Evict least valuable memories (lowest access frequency + priority) in a namespace",
  {
    namespace: z.string(),
    keep_count: z.number().optional().default(100),
  },
  async ({ namespace, keep_count }) => {
    const evicted = await evictLeastValuable(sql, namespace, keep_count);
    return text({ evicted });
  },
);


// ─── Archival Policies ────────────────────────────────────────────────────────

server.tool(
  "memory_create_archival_policy",
  "Create an archival policy — defines when memories auto-archive based on age/type/access",
  {
    workspace_id: z.string(),
    name: z.string(),
    conditions: z.object({
      max_age_days: z.number().int().positive().optional(),
      memory_types: z.array(MemoryTypeEnum).optional(),
      min_access_count: z.number().int().nonnegative().optional(),
      namespaces: z.array(z.string()).optional(),
    }),
    action: z.enum(["archive", "delete", "downgrade_type"]).default("archive"),
    enabled: z.boolean().optional().default(true),
  },
  async ({ workspace_id, name, conditions, action, enabled }) => {
    const { createArchivalPolicy } = await import("../lib/index.js");
    return text(await createArchivalPolicy(sql, { workspaceId: workspace_id, name, conditions, action, enabled }));
  },
);

server.tool(
  "memory_list_archival_policies",
  "List all archival policies for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const { listArchivalPolicies } = await import("../lib/index.js");
    return text(await listArchivalPolicies(sql, workspace_id));
  },
);

server.tool(
  "memory_execute_archival_policies",
  "Execute all enabled archival policies for a workspace (dry_run returns count without deleting)",
  {
    workspace_id: z.string(),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ workspace_id, dry_run }) => {
    const { executeArchivalPolicies } = await import("../lib/index.js");
    return text(await executeArchivalPolicies(sql, workspace_id, dry_run));
  },
);


// ---- Archival policies ----

server.tool(
  "memory_create_archival_policy",
  "Create an archival policy for a workspace",
  {
    workspace_id: z.string(),
    archive_tier: z.enum(["cold", "frozen", "deleted"]),
    trigger: z.enum(["age", "importance_threshold", "access_threshold", "namespace_quota", "manual"]),
    namespace: z.string().optional(),
    memory_type: z.string().optional(),
    age_threshold_seconds: z.number().optional(),
    importance_floor: z.number().min(0).max(1).optional(),
    access_count_floor: z.number().optional(),
    namespace_quota: z.number().optional(),
    enabled: z.boolean().optional(),
    retain_forever: z.boolean().optional(),
  },
  async (opts) =>
    text(
      await createArchivalPolicy(sql, {
        workspaceId: opts.workspace_id,
        namespace: opts.namespace,
        memoryType: opts.memory_type,
        archiveTier: opts.archive_tier,
        trigger: opts.trigger,
        ageThresholdSeconds: opts.age_threshold_seconds,
        importanceFloor: opts.importance_floor,
        accessCountFloor: opts.access_count_floor,
        namespaceQuota: opts.namespace_quota,
        enabled: opts.enabled,
        retainForever: opts.retain_forever,
      }),
    ),
);

server.tool(
  "memory_list_archival_policies",
  "List archival policies for a workspace",
  {
    workspace_id: z.string(),
    enabled: z.boolean().optional(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, enabled, namespace }) =>
    text(await listArchivalPolicies(sql, workspace_id, { enabled, namespace })),
);

server.tool(
  "memory_update_archival_policy",
  "Update an archival policy",
  {
    id: z.string(),
    namespace: z.string().optional(),
    memory_type: z.string().optional(),
    archive_tier: z.enum(["cold", "frozen", "deleted"]).optional(),
    trigger: z.enum(["age", "importance_threshold", "access_threshold", "namespace_quota", "manual"]).optional(),
    age_threshold_seconds: z.number().optional(),
    importance_floor: z.number().min(0).max(1).optional(),
    access_count_floor: z.number().optional(),
    namespace_quota: z.number().optional(),
    enabled: z.boolean().optional(),
    retain_forever: z.boolean().optional(),
  },
  async (opts) =>
    text(
      await updateArchivalPolicy(sql, opts.id, {
        namespace: opts.namespace,
        memoryType: opts.memory_type,
        archiveTier: opts.archive_tier,
        trigger: opts.trigger,
        ageThresholdSeconds: opts.age_threshold_seconds,
        importanceFloor: opts.importance_floor,
        accessCountFloor: opts.access_count_floor,
        namespaceQuota: opts.namespace_quota,
        enabled: opts.enabled,
        retainForever: opts.retain_forever,
      }),
    ),
);

server.tool(
  "memory_delete_archival_policy",
  "Delete an archival policy",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteArchivalPolicy(sql, id) }),
);

server.tool(
  "memory_execute_archival_policies",
  "Execute all enabled archival policies for a workspace (run on a schedule)",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await executeArchivalPolicies(sql, workspace_id)),
);

server.tool(
  "memory_archival_history",
  "List archival history for a workspace",
  {
    workspace_id: z.string(),
    memory_id: z.string().optional(),
    archive_tier: z.enum(["cold", "frozen", "deleted"]).optional(),
    since: z.string().datetime().optional(),
    limit: z.number().optional().default(100),
  },
  async ({ workspace_id, memory_id, archive_tier, since, limit }) =>
    text(
      await listArchivalHistory(sql, workspace_id, {
        memoryId: memory_id,
        archiveTier: archive_tier,
        since: since ? new Date(since) : undefined,
        limit,
      }),
    ),
);

// Tiered TTL — soft-expire with grace periods
server.tool(
  "memory_apply_soft_expire",
  "Apply soft-expire to all expired memories using namespace grace periods",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) => ({ content: [{ type: "text", text: JSON.stringify({ softExpired: await applySoftExpire(sql, workspace_id) }) }] }),
);

server.tool(
  "memory_purge_soft_expired",
  "Hard-purge all soft-expired memories past their grace period",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) => ({ content: [{ type: "text", text: JSON.stringify({ purged: await purgeSoftExpired(sql, workspace_id) }) }] }),
);

server.tool(
  "memory_ttl_stats",
  "Get TTL enforcement statistics for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getTtlStats(sql, workspace_id)),
);

// Namespace budgets and auto-classification
server.tool(
  "memory_get_namespace_budget",
  "Get memory budget for a namespace",
  { workspace_id: z.string(), namespace: z.string() },
  async ({ workspace_id, namespace }) => text(await getNamespaceBudget(sql, workspace_id, namespace) ?? { error: "not found" }),
);

server.tool(
  "memory_set_namespace_budget",
  "Set or update a namespace memory quota",
  {
    workspace_id: z.string(),
    namespace: z.string(),
    max_memories: z.number(),
    enforce_quota: z.boolean().optional().default(false),
  },
  async ({ workspace_id, namespace, max_memories, enforce_quota }) =>
    text(await setNamespaceBudget(sql, workspace_id, namespace, max_memories, enforce_quota ?? false)),
);

server.tool(
  "memory_enforce_namespace_quota",
  "Enforce namespace memory quota — evict lowest-importance memories if over limit",
  { workspace_id: z.string(), namespace: z.string(), dry_run: z.boolean().optional().default(false) },
  async ({ workspace_id, namespace, dry_run }) =>
    ({ content: [{ type: "text", text: JSON.stringify({ evicted: await enforceNamespaceQuota(sql, workspace_id, namespace, dry_run ?? false) }) }] }),
);

server.tool(
  "memory_classify_memory",
  "Auto-classify a memory into episodic/semantic/procedural/context based on routing rules",
  {
    workspace_id: z.string(),
    memory_id: z.string(),
    content: z.string(),
    summary: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  },
  async ({ workspace_id, memory_id, content, summary, metadata }) =>
    text(await classifyMemory(sql, workspace_id, memory_id, content, summary, metadata) ?? { classified: false }),
);

server.tool(
  "memory_list_classifications",
  "List memory classifications for a workspace",
  { workspace_id: z.string(), classified_type: MemoryTypeEnum.optional() },
  async ({ workspace_id, classified_type }) =>
    text(await listMemoryClassifications(sql, workspace_id, classified_type)),
);


// --- Backup / restore ---

server.tool(
  "memory_export_snapshot",
  "Export all memories for a workspace as a JSON snapshot",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) =>
    text(await exportMemorySnapshot(sql, workspace_id, namespace)),
);

server.tool(
  "memory_import_snapshot",
  "Import a memory snapshot into a workspace",
  {
    workspace_id: z.string(),
    snapshot: z.object({
      metadata: z.record(z.any()),
      memories: z.array(z.object({
        workspace_id: z.string(),
        collection_id: z.string().nullable(),
        content: z.string(),
        summary: z.string().nullable(),
        importance: z.number(),
        memory_type: z.string(),
        priority: z.number(),
        metadata: z.record(z.any()),
        embedding_text: z.string().nullable(),
        expires_at: z.string().nullable(),
        ttl_seconds: z.number(),
        is_pinned: z.boolean(),
        created_at: z.string(),
      })),
    }),
    conflict_strategy: z.enum(["skip", "overwrite", "duplicate"]).optional().default("skip"),
  },
  async ({ workspace_id, snapshot, conflict_strategy }) => {
    const result = await importMemorySnapshot(sql, workspace_id, snapshot, conflict_strategy);
    return text(result);
  },
);

server.tool(
  "memory_snapshot_info",
  "Get snapshot metadata without importing",
  {
    snapshot: z.object({
      metadata: z.record(z.any()),
      memories: z.array(z.any()),
    }),
  },
  async ({ snapshot }) => text(getSnapshotInfo(snapshot)),
);


// ─── Boost Management ─────────────────────────────────────────────────────────

server.tool(
  "memory_boost",
  "Boost a memory's priority/temporarily elevate its importance score",
  {
    memory_id: z.string(),
    boost_amount: z.number().min(0).max(1).optional().default(0.2),
    reason: z.string().optional(),
  },
  async ({ memory_id, boost_amount, reason }) => {
    const { boostMemory } = await import("../lib/index.js");
    return text(await boostMemory(sql, memory_id, boost_amount, reason));
  },
);

server.tool(
  "memory_get_boost",
  "Get current boost information for a memory",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    const { getMemoryBoost } = await import("../lib/index.js");
    return text(await getMemoryBoost(sql, memory_id));
  },
);

server.tool(
  "memory_decay_boosts",
  "Decay all expired boosts (run this periodically to restore boosted memories to normal)",
  {
    workspace_id: z.string().optional(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { decayExpiredBoosts } = await import("../lib/index.js");
    return text({ decayed: await decayExpiredBoosts(sql, workspace_id, namespace) });
  },
);


// --- Boost tools ---

server.tool(
  "memory_boost",
  "Temporarily boost a memory's importance (stacks additively, expires after TTL)",
  {
    memory_id: z.string(),
    boost_type: z.enum(["manual", "accessed", "referenced", "linked", "searched"]).optional().default("manual"),
    boost_value: z.number().min(0.1).max(10.0).optional().default(1.0),
    ttl_minutes: z.number().int().min(1).optional().default(60),
    reason: z.string().optional(),
  },
  async ({ memory_id, boost_type, boost_value, ttl_minutes, reason }) => {
    const expiresAt = new Date(Date.now() + ttl_minutes * 60 * 1000);
    return text(await boostMemory(sql, { memoryId: memory_id, boostType: boost_type, boostValue: boost_value, expiresAt, reason }));
  },
);

server.tool(
  "memory_get_boost",
  "Get the current total boost value for a memory",
  { memory_id: z.string() },
  async ({ memory_id }) => text(await getMemoryBoost(sql, memory_id)),
);

server.tool(
  "memory_decay_boosts",
  "Remove expired boost records from the database",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text({ expired: await decayExpiredBoosts(sql, workspace_id) }),
);


// ─── Bulk Operations ──────────────────────────────────────────────────────────

server.tool(
  "memory_bulk_store",
  "Store multiple memories in a single call (batch insert)",
  {
    memories: z.array(z.object({
      workspace_id: z.string(),
      collection_id: z.string().optional(),
      content: z.string(),
      summary: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      memory_type: MemoryTypeEnum.optional(),
      metadata: z.record(z.any()).optional(),
      ttl_seconds: z.number().int().min(0).optional(),
    })).max(100),
  },
  async ({ memories }) => {
    const { bulkStoreMemories } = await import("../lib/index.js");
    return text(await bulkStoreMemories(sql, memories));
  },
);

server.tool(
  "memory_bulk_update",
  "Update multiple memories in a single call (batch update by ID)",
  {
    updates: z.array(z.object({
      id: z.string(),
      content: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      memory_type: MemoryTypeEnum.optional(),
      metadata: z.record(z.any()).optional(),
      expires_at: z.string().datetime().nullable().optional(),
    })).max(100),
  },
  async ({ updates }) => {
    const { bulkUpdateMemories } = await import("../lib/index.js");
    return text({ updated: await bulkUpdateMemories(sql, updates) });
  },
);

server.tool(
  "memory_bulk_delete",
  "Delete multiple memories in a single call",
  {
    ids: z.array(z.string()).max(100),
    reason: z.string().optional(),
  },
  async ({ ids, reason }) => {
    const { bulkDeleteMemories } = await import("../lib/index.js");
    return text({ deleted: await bulkDeleteMemories(sql, ids, reason) });
  },
);


// ---- Bulk operations ----

server.tool(
  "memory_bulk_store",
  "Insert multiple memories in a single transaction",
  {
    workspace_id: z.string(),
    items: z.array(
      z.object({
        content: z.string(),
        user_id: z.string().optional(),
        collection_id: z.string().optional(),
        summary: z.string().optional(),
        importance: z.number().min(0).max(1).optional(),
        memory_type: MemoryTypeEnum.optional(),
        priority: z.number().optional(),
        metadata: z.record(z.any()).optional(),
        expires_at: z.string().datetime().optional(),
        ttl_seconds: z.number().int().min(0).optional(),
        is_pinned: z.boolean().optional(),
      }),
    ),
  },
  async ({ workspace_id, items }) =>
    text(
      await bulkStoreMemories(sql, {
        workspaceId: workspace_id,
        items: items.map((i) => ({
          content: i.content,
          userId: i.user_id,
          collectionId: i.collection_id,
          summary: i.summary,
          importance: i.importance,
          memoryType: i.memory_type,
          priority: i.priority,
          metadata: i.metadata,
          expiresAt: i.expires_at ? new Date(i.expires_at) : undefined,
          ttlSeconds: i.ttl_seconds,
          isPinned: i.is_pinned,
        })),
      }),
    ),
);

server.tool(
  "memory_bulk_update",
  "Update multiple memories in a single transaction",
  {
    ids: z.array(z.string()),
    updates: z.object({
      content: z.string().optional(),
      summary: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      priority: z.number().optional(),
      metadata: z.record(z.any()).optional(),
      is_pinned: z.boolean().optional(),
      expires_at: z.string().datetime().nullable().optional(),
    }),
  },
  async ({ ids, updates }) =>
    text(
      await bulkUpdateMemories(sql, {
        ids,
        updates: {
          content: updates.content,
          summary: updates.summary,
          importance: updates.importance,
          priority: updates.priority,
          metadata: updates.metadata,
          isPinned: updates.is_pinned,
          expiresAt: updates.expires_at ? new Date(updates.expires_at) : undefined,
        },
      }),
    ),
);

server.tool(
  "memory_bulk_delete",
  "Delete multiple memories in a single transaction",
  {
    ids: z.array(z.string()),
  },
  async ({ ids }) => text(await bulkDeleteMemories(sql, ids)),
);


// --- Collection policies ---

server.tool(
  "memory_upsert_collection_policy",
  "Create or update a collection-level policy (default TTL, memory type, importance, max memories)",
  {
    collection_id: z.string().describe("Collection UUID"),
    workspace_id: z.string().describe("Workspace UUID"),
    default_memory_type: MemoryTypeEnum.optional(),
    default_importance: z.number().min(0).max(1).optional(),
    default_priority: z.number().int().optional(),
    default_ttl_seconds: z.number().int().min(0).optional(),
    max_memories: z.number().int().positive().optional(),
    allow_duplicates: z.boolean().optional(),
    auto_consolidate: z.boolean().optional(),
    consolidation_window_hours: z.number().int().positive().optional(),
  },
  async (opts) =>
    text(await upsertCollectionPolicy(sql, {
      collectionId: opts.collection_id,
      workspaceId: opts.workspace_id,
      defaultMemoryType: opts.default_memory_type,
      defaultImportance: opts.default_importance,
      defaultPriority: opts.default_priority,
      defaultTtlSeconds: opts.default_ttl_seconds,
      maxMemories: opts.max_memories,
      allowDuplicates: opts.allow_duplicates,
      autoConsolidate: opts.auto_consolidate,
      consolidationWindowHours: opts.consolidation_window_hours,
    })),
);

server.tool(
  "memory_get_collection_policy",
  "Get the policy for a specific collection",
  { collection_id: z.string() },
  async ({ collection_id }) =>
    text(await getCollectionPolicy(sql, collection_id) ?? { no_policy: true }),
);

server.tool(
  "memory_list_collection_policies",
  "List all collection policies for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listCollectionPolicies(sql, workspace_id)),
);

server.tool(
  "memory_delete_collection_policy",
  "Delete a collection policy",
  { collection_id: z.string() },
  async ({ collection_id }) =>
    text({ deleted: await deleteCollectionPolicy(sql, collection_id) }),
);

server.tool(
  "memory_effective_defaults",
  "Get the effective defaults for a collection (policy or global defaults)",
  { collection_id: z.string() },
  async ({ collection_id }) =>
    text(await getEffectiveCollectionDefaults(sql, collection_id)),
);

server.tool(
  "memory_collection_at_capacity",
  "Check if a collection has reached its max_memories limit",
  { collection_id: z.string() },
  async ({ collection_id }) => text(await isCollectionAtCapacity(sql, collection_id)),
);


// --- Consolidation policies ---

server.tool(
  "memory_upsert_consolidation_policy",
  "Create or update a scheduled consolidation policy for episodic memories",
  {
    workspace_id: z.string(),
    namespace: z.string(),
    name: z.string(),
    trigger: z.enum(["schedule", "count_threshold", "size_threshold", "manual"]).optional(),
    cron_expression: z.string().optional(),
    min_episodic_count: z.number().int().positive().optional(),
    min_total_size_bytes: z.number().int().positive().optional(),
    window_hours: z.number().int().positive().optional().default(24),
    consolidation_mode: z.enum(["summary_only", "delete_source", "archive"]).optional(),
    priority_threshold: z.number().int().optional(),
    memory_type_filter: z.string().optional(),
  },
  async (opts) =>
    text(await upsertConsolidationPolicy(sql, {
      workspaceId: opts.workspace_id,
      namespace: opts.namespace,
      name: opts.name,
      trigger: opts.trigger,
      cronExpression: opts.cron_expression,
      minEpisodicCount: opts.min_episodic_count,
      minTotalSizeBytes: opts.min_total_size_bytes,
      windowHours: opts.window_hours,
      consolidationMode: opts.consolidation_mode,
      priorityThreshold: opts.priority_threshold,
      memoryTypeFilter: opts.memory_type_filter,
    })),
);

server.tool(
  "memory_set_consolidation_policy_enabled",
  "Enable or disable a consolidation policy",
  {
    policy_id: z.string(),
    enabled: z.boolean(),
  },
  async ({ policy_id, enabled }) => {
    await setConsolidationPolicyEnabled(sql, policy_id, enabled);
    return text({ ok: true });
  },
);

server.tool(
  "memory_list_consolidation_policies",
  "List all consolidation policies for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await listConsolidationPolicies(sql, workspace_id)),
);

server.tool(
  "memory_get_consolidation_policy",
  "Get a consolidation policy by ID",
  { policy_id: z.string() },
  async ({ policy_id }) => text(await getConsolidationPolicy(sql, policy_id)),
);

server.tool(
  "memory_get_due_consolidation_policies",
  "Get enabled consolidation policies that are due to run",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await getDueConsolidationPolicies(sql, workspace_id)),
);

server.tool(
  "memory_run_consolidation_policy",
  "Manually trigger a consolidation policy to run immediately",
  { policy_id: z.string() },
  async ({ policy_id }) => text(await runConsolidationPolicy(sql, policy_id)),
);

server.tool(
  "memory_delete_consolidation_policy",
  "Delete a consolidation policy",
  { policy_id: z.string() },
  async ({ policy_id }) =>
    text({ deleted: await deleteConsolidationPolicy(sql, policy_id) }),
);

server.tool(
  "memory_consolidation_stats",
  "Get summary stats of consolidation policies for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getConsolidationPolicyStats(sql, workspace_id)),
);


// ─── Consolidation ────────────────────────────────────────────────────────────

server.tool(
  "memory_consolidate_episodic",
  "Consolidate episodic memories into semantic memories — summarization and storage of key facts",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ workspace_id, namespace, dry_run }) => {
    const { consolidateEpisodicMemories } = await import("../lib/consolidation.js");
    return text(await consolidateEpisodicMemories(sql, workspace_id, namespace, dry_run));
  },
);

server.tool(
  "memory_get_consolidation_candidates",
  "Get episodic memories that are good candidates for consolidation (old, unlinked, low importance)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    max_age_days: z.number().optional().default(30),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, namespace, max_age_days, limit }) => {
    const { getConsolidationCandidates } = await import("../lib/consolidation.js");
    return text(await getConsolidationCandidates(sql, workspace_id, namespace, max_age_days, limit));
  },
);

server.tool(
  "memory_rerank",
  "Rerank memories using a scoring function that considers recency, importance, link centrality, and recall frequency",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    boost_recency: z.boolean().optional().default(true),
    boost_importance: z.boolean().optional().default(true),
    boost_links: z.boolean().optional().default(true),
    boost_recall: z.boolean().optional().default(true),
    limit: z.number().optional().default(100),
  },
  async ({ workspace_id, namespace, boost_recency, boost_importance, boost_links, boost_recall, limit }) => {
    const { rerankMemories } = await import("../lib/rerank.js");
    return text(await rerankMemories(sql, workspace_id, namespace, {
      boostRecency: boost_recency, boostImportance: boost_importance, boostLinks: boost_links, boostRecall: boost_recall, limit
    }));
  },
);


server.tool(
  "memory_store",
  "Store a new memory with optional embedding for semantic search",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    collection_id: z.string().optional(),
    content: z.string(),
    summary: z.string().optional(),
    importance: z.number().min(0).max(1).optional(),
    memory_type: MemoryTypeEnum.optional().default("semantic"),
    priority: z.number().optional().default(0),
    metadata: z.record(z.any()).optional(),
    expires_at: z.string().datetime().optional(),
    ttl_seconds: z.number().int().min(0).optional().default(0),
    is_pinned: z.boolean().optional().default(false),
  },
  async ({ workspace_id, user_id, collection_id, content, summary, importance, memory_type, priority, metadata, expires_at, ttl_seconds, is_pinned }) =>
    text(
      await storeMemory(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        collectionId: collection_id,
        content,
        summary,
        importance,
        memoryType: memory_type,
        priority,
        metadata,
        expiresAt: expires_at ? new Date(expires_at) : undefined,
        ttlSeconds: ttl_seconds,
        isPinned: is_pinned,
      }),
    ),
);

server.tool(
  "memory_search",
  "Search memories by text (full-text or semantic if embeddings available)",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    text: z.string(),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text"),
    limit: z.number().optional().default(10),
    collection_id: z.string().optional(),
    namespace: z.string().optional(),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, user_id, text: searchText, mode, limit, collection_id, namespace, memory_type }) =>
    text(
      await searchMemories(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        text: searchText,
        mode,
        limit,
        collectionId: collection_id,
        namespace,
        memoryType: memory_type,
      }),
    ),
);

server.tool(
  "memory_recall",
  "Recall memories relevant to a query (alias for search with simpler input)",
  {
    workspace_id: z.string(),
    query: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(10),
    namespace: z.string().optional(),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, query, user_id, limit, namespace, memory_type }) =>
    text(
      await searchMemories(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        text: query,
        mode: "hybrid",
        limit,
        namespace,
        memoryType: memory_type,
      }),
    ),
);

server.tool(
  "memory_delete",
  "Delete a memory by ID",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteMemory(sql, id) }),
);

server.tool(
  "memory_list",
  "List memories for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(50),
    namespace: z.string().optional(),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, user_id, limit, namespace, memory_type }) =>
    text(
      await listMemories(sql, workspace_id, user_id, limit, { namespace, memoryType: memory_type }),
    ),
);

server.tool(
  "memory_list_collections",
  "List collections for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
  },
  async ({ workspace_id, user_id }) =>
    text(
      await listCollections(sql, workspace_id, user_id),
    ),
);

server.tool(
  "memory_create_collection",
  "Create a new memory collection",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
  },
  async (collectionData) =>
    text(
      await createCollection(sql, {
        workspaceId: collectionData.workspace_id,
        userId: collectionData.user_id,
        name: collectionData.name,
        description: collectionData.description,
      }),
    ),
);

server.tool(
  "memory_get_collection",
  "Get a single memory collection by ID",
  {
    collection_id: z.string(),
  },
  async ({ collection_id }) =>
    text(await getCollection(sql, collection_id)),
);

server.tool(
  "memory_delete_collection",
  "Delete a memory collection (deletes the collection itself, not its memories — use memory_delete_collection_memories to delete memories)",
  {
    collection_id: z.string(),
  },
  async ({ collection_id }) =>
    text({ deleted: await deleteCollection(sql, collection_id) }),
);

server.tool(
  "memory_get_collection_stats",
  "Get statistics for a memory collection (memory counts by type, pinned count, expired count, avg importance, avg TTL)",
  {
    collection_id: z.string(),
  },
  async ({ collection_id }) =>
    text(await getCollectionStats(sql, collection_id)),
);

server.tool(
  "memory_update_importance",
  "Update the importance score of a memory (0.0 to 1.0)",
  {
    id: z.string(),
    importance: z.number().min(0).max(1),
  },
  async ({ id, importance }) => {
    await updateMemoryImportance(sql, id, importance);
    return text({ ok: true });
  },
);

server.tool(
  "memory_delete_expired",
  "Delete all expired memories (past their expires_at timestamp)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    // Note: namespace filtering would require a join; for simplicity we delete all expired in workspace
    const count = await deleteExpiredMemories(sql, workspace_id);
    return text({ deleted: count });
  },
);

server.tool(
  "memory_delete_by_age",
  "Delete memories older than max_age_seconds (LRU-style eviction)",
  {
    workspace_id: z.string(),
    max_age_seconds: z.number().positive(),
  },
  async ({ workspace_id, max_age_seconds }) => {
    const count = await deleteMemoriesByAge(sql, workspace_id, max_age_seconds);
    return text({ deleted: count });
  },
);

server.tool(
  "memory_delete_by_namespace",
  "Delete all memories in a namespace (optionally within a collection)",
  {
    workspace_id: z.string(),
    namespace: z.string(),
    collection_id: z.string().optional(),
  },
  async ({ workspace_id, namespace, collection_id }) => {
    const count = await deleteMemoriesByNamespace(sql, workspace_id, namespace, collection_id);
    return text({ deleted: count });
  },
);

server.tool(
  "memory_update",
  "Update memory fields: content, summary, importance, type, priority, metadata, expires_at, is_pinned, ttl_seconds",
  {
    id: z.string(),
    content: z.string().optional(),
    summary: z.string().optional(),
    importance: z.number().min(0).max(1).optional(),
    memory_type: MemoryTypeEnum.optional(),
    priority: z.number().optional(),
    metadata: z.record(z.any()).optional(),
    expires_at: z.string().datetime().nullable().optional(),
    is_pinned: z.boolean().optional(),
    ttl_seconds: z.number().int().min(0).optional(),
  },
  async ({ id, content, summary, importance, memory_type, priority, metadata, expires_at, is_pinned, ttl_seconds }) => {
    const result = await updateMemory(sql, id, {
      content,
      summary,
      importance,
      memoryType: memory_type,
      priority,
      metadata,
      expiresAt: expires_at === null ? null : expires_at ? new Date(expires_at) : undefined,
      isPinned: is_pinned,
      ttlSeconds: ttl_seconds,
    });
    return text(result ?? { error: "Memory not found" });
  },
);

server.tool(
  "memory_pin",
  "Pin a memory so it is never auto-deleted and ignores TTL",
  { id: z.string() },
  async ({ id }) => text({ memory: await pinMemory(sql, id) ?? { error: "Memory not found" } }),
);

server.tool(
  "memory_unpin",
  "Unpin a memory, restoring normal TTL/expiry behavior",
  { id: z.string() },
  async ({ id }) => text({ memory: await unpinMemory(sql, id) ?? { error: "Memory not found" } }),
);

server.tool(
  "memory_fork",
  "Fork (copy) a memory into a new namespace. The forked copy is never pinned.",
  {
    id: z.string(),
    target_namespace: z.string(),
    target_collection_id: z.string().optional(),
  },
  async ({ id, target_namespace, target_collection_id }) => {
    const memory = await forkMemory(sql, id, target_namespace, target_collection_id);
    return text({ memory: memory ?? { error: "Memory not found or target namespace has no collection" } });
  },
);

server.tool(
  "memory_recommend",
  "Recommend related memories based on recent access patterns or similar content",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    seed_memory_ids: z.array(z.string()).optional(),
    namespace: z.string().optional(),
    limit: z.number().optional().default(10),
  },
  async ({ workspace_id, user_id, seed_memory_ids, namespace, limit }) =>
    text(
      await recommendMemories(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        memoryIds: seed_memory_ids,
        namespace,
        limit,
      }),
    ),
);

server.tool(
  "memory_stats",
  "Get memory statistics for a workspace: total, expired, pinned counts, type distribution, namespace/collection counts",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getMemoryStats(sql, workspace_id)),
);

server.tool(
  "memory_purge_expired",
  "Hard-delete all expired memories regardless of pinned status. Use with caution.",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => {
    const count = await purgeExpiredMemories(sql, workspace_id);
    return text({ deleted: count });
  },
);

server.tool(
  "memory_delete_collection_memories",
  "Delete all memories in a collection",
  { collection_id: z.string() },
  async ({ collection_id }) => {
    const count = await deleteAllMemoriesInCollection(sql, collection_id);
    return text({ deleted: count });
  },
);


// ---- Cross-namespace search ----

server.tool(
  "memory_cross_namespace_search",
  "Search memories across multiple namespaces simultaneously",
  {
    workspace_id: z.string(),
    text: z.string(),
    namespaces: z.array(z.string()),
    user_id: z.string().optional(),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text"),
    limit: z.number().optional().default(20),
    collection_id: z.string().optional(),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, text, namespaces, user_id, mode, limit, collection_id, memory_type }) =>
    text(
      await searchCrossNamespace(sql, {
        workspaceId: workspace_id,
        text,
        namespaces,
        userId: user_id,
        mode,
        limit,
        collectionId: collection_id,
        memoryType: memory_type,
      }),
    ),
);

server.tool(
  "memory_namespace_counts",
  "Get memory counts per namespace for a workspace",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => text(await getNamespaceMemoryCounts(sql, workspace_id)),
);


// --- Deduplication tools ---

server.tool(
  "memory_find_duplicates",
  "Find groups of near-duplicate memories using simhash + Jaro-Winkler similarity",
  {
    workspace_id: z.string(),
    collection_id: z.string().optional(),
    namespace: z.string().optional(),
    similarity_threshold: z.number().min(0).max(1).optional().default(0.85),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, collection_id, namespace, similarity_threshold, memory_type }) =>
    text(await findDuplicateGroups(sql, {
      workspaceId: workspace_id,
      collectionId: collection_id,
      namespace,
      similarityThreshold: similarity_threshold,
      memoryType: memory_type,
    })),
);

server.tool(
  "memory_merge_duplicates",
  "Merge duplicate memories into a single canonical memory, deleting the others",
  {
    canonical_memory_id: z.string(),
    duplicate_memory_ids: z.array(z.string()),
    delete_links: z.boolean().optional().default(true),
  },
  async ({ canonical_memory_id, duplicate_memory_ids, delete_links }) =>
    text(await mergeDuplicate(sql, canonical_memory_id, duplicate_memory_ids, delete_links)),
);


// ─── Delete Memories by Age ────────────────────────────────────────────────────

server.tool(
  "memory_delete_memories_by_age",
  "Delete memories older than a specified age — useful for compliance and data retention",
  {
    workspace_id: z.string(),
    older_than_days: z.number().int().positive().describe("Delete memories older than this many days"),
    namespace: z.string().optional().describe("Limit to a specific namespace"),
    memory_type: MemoryTypeEnum.optional().describe("Only delete memories of this type"),
    dry_run: z.boolean().optional().default(false).describe("If true, count how many would be deleted without actually deleting"),
  },
  async ({ workspace_id, older_than_days, namespace, memory_type, dry_run }) => {
    const { deleteMemoriesByAge } = await import("../lib/ttl.js");
    return text({ deleted: dry_run ? 0 : await deleteMemoriesByAge(sql, workspace_id, older_than_days, namespace, memory_type), dry_run });
  },
);


// ─── Duplicate Detection ──────────────────────────────────────────────────────

server.tool(
  "memory_find_duplicates",
  "Find near-duplicate memory groups using embedding similarity",
  {
    workspace_id: z.string(),
    threshold: z.number().min(0).max(1).optional().default(0.95),
    namespace: z.string().optional(),
    limit: z.number().optional().default(20),
  },
  async ({ workspace_id, threshold, namespace, limit }) => {
    const { findDuplicateGroups } = await import("../lib/index.js");
    return text(await findDuplicateGroups(sql, workspace_id, threshold, namespace, limit));
  },
);

server.tool(
  "memory_merge_duplicates",
  "Merge a duplicate group into a single canonical memory",
  {
    group_id: z.string().describe("Duplicate group ID from find_duplicates"),
    keep_id: z.string().optional().describe("ID of memory to keep; omit to keep highest quality"),
    archive_others: z.boolean().optional().default(true),
  },
  async ({ group_id, keep_id, archive_others }) => {
    const { mergeDuplicate } = await import("../lib/index.js");
    return text(await mergeDuplicate(sql, group_id, keep_id, archive_others));
  },
);


// --- Episodic consolidation ---

server.tool(
  "memory_consolidate_episodic",
  "Consolidate episodic memories in a time window into a semantic summary memory",
  {
    workspace_id: z.string(),
    time_window_hours: z.number().optional().default(24),
    delete_old: z.boolean().optional().default(false),
  },
  async ({ workspace_id, time_window_hours, delete_old }) =>
    text(await consolidateEpisodicMemories(sql, workspace_id, time_window_hours, delete_old)),
);

server.tool(
  "memory_get_consolidation_candidates",
  "Get consolidation candidates — episodic memories eligible for consolidation",
  {
    workspace_id: z.string(),
    time_window_hours: z.number().optional().default(24),
  },
  async ({ workspace_id, time_window_hours }) =>
    text(await getConsolidationCandidates(sql, workspace_id, time_window_hours)),
);


// ─── Get Expiring Memories ─────────────────────────────────────────────────────

server.tool(
  "memory_get_expiring_memories",
  "Get memories that are about to expire (within the warning window) — useful for triggering refresh or archival",
  {
    workspace_id: z.string(),
    within_hours: z.number().optional().default(72).describe("Show memories expiring within this many hours (default 72)"),
    namespace: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, within_hours, namespace, limit }) => {
    const { getExpiringMemories } = await import("../lib/ttl.js");
    return text(await getExpiringMemories(sql, workspace_id, within_hours ?? 72, namespace, limit));
  },
);


// ─── Importance Auto-tuning ──────────────────────────────────────────────────

server.tool(
  "memory_analyze_importance_tuning",
  "Analyze access patterns and suggest importance adjustments for a workspace",
  {
    workspace_id: z.string(),
    lookback_days: z.number().optional().default(30),
  },
  async ({ workspace_id, lookback_days }) => {
    const { analyzeImportanceTuning } = await import("../lib/memory-importance-tuning.js");
    return text(await analyzeImportanceTuning(sql, workspace_id, lookback_days));
  },
);

server.tool(
  "memory_apply_importance_tuning",
  "Apply importance tuning suggestions to update memory scores",
  {
    workspace_id: z.string(),
    min_delta: z.number().optional().default(0.05),
  },
  async ({ workspace_id, min_delta }) => {
    const { applyImportanceTuning } = await import("../lib/memory-importance-tuning.js");
    return text(await applyImportanceTuning(sql, workspace_id, min_delta));
  },
);

server.tool(
  "memory_get_most_improved",
  "Get memories with the most improved importance scores",
  {
    workspace_id: z.string(),
    limit: z.number().optional().default(20),
  },
  async ({ workspace_id, limit }) => {
    const { getMostImprovedMemories } = await import("../lib/memory-importance-tuning.js");
    return text(await getMostImprovedMemories(sql, workspace_id, limit));
  },
);


// ─── Memory Analytics ─────────────────────────────────────────────────────────

server.tool(
  "memory_get_trends",
  "Get memory creation and access trends over a time period",
  {
    workspace_id: z.string(),
    period_days: z.number().optional().default(30),
  },
  async ({ workspace_id, period_days }) => {
    const { getMemoryTrends } = await import("../lib/memory-analytics.js");
    return text(await getMemoryTrends(sql, workspace_id, period_days));
  },
);

server.tool(
  "memory_get_health_score",
  "Compute overall health score for a workspace's memory system",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => {
    const { computeMemoryHealthScore } = await import("../lib/memory-analytics.js");
    return text(await computeMemoryHealthScore(sql, workspace_id));
  },
);

server.tool(
  "memory_get_type_trend",
  "Get memory type distribution over time",
  {
    workspace_id: z.string(),
    days: z.number().optional().default(30),
  },
  async ({ workspace_id, days }) => {
    const { getMemoryTypeTrend } = await import("../lib/memory-analytics.js");
    return text(await getMemoryTypeTrend(sql, workspace_id, days));
  },
);

server.tool(
  "memory_get_access_heatmap",
  "Get access heatmap (hour × day-of-week) for a workspace",
  {
    workspace_id: z.string(),
    days: z.number().optional().default(30),
  },
  async ({ workspace_id, days }) => {
    const { getAccessHeatmap } = await import("../lib/memory-analytics.js");
    return text(await getAccessHeatmap(sql, workspace_id, days));
  },
);


// ─── Memory Archival Policies ─────────────────────────────────────────────────

server.tool(
  "memory_create_archival_policy",
  "Create an automatic archival policy for memories",
  {
    workspace_id: z.string(),
    archive_tier: z.enum(["cold", "frozen", "deleted"]),
    trigger: z.enum(["age", "importance_threshold", "access_threshold", "namespace_quota", "manual"]),
    namespace: z.string().optional(),
    memory_type: z.string().optional(),
    age_threshold_seconds: z.number().int().optional(),
    importance_floor: z.number().optional(),
    access_count_floor: z.number().int().optional(),
    namespace_quota: z.number().int().optional(),
    retain_forever: z.boolean().optional().default(false),
    enabled: z.boolean().optional().default(true),
  },
  async ({
    workspace_id, archive_tier, trigger, namespace, memory_type,
    age_threshold_seconds, importance_floor, access_count_floor,
    namespace_quota, retain_forever, enabled,
  }) => {
    const { createArchivalPolicy } = await import("../lib/archival-policies.js");
    return text(await createArchivalPolicy(sql, {
      workspaceId: workspace_id,
      archiveTier: archive_tier as any,
      trigger: trigger as any,
      namespace: namespace ?? null,
      memoryType: memory_type ?? null,
      ageThresholdSeconds: age_threshold_seconds ?? null,
      importanceFloor: importance_floor ?? null,
      accessCountFloor: access_count_floor ?? null,
      namespaceQuota: namespace_quota ?? null,
      retainForever: retain_forever ?? false,
      enabled: enabled ?? true,
    }));
  },
);

server.tool(
  "memory_list_archival_policies",
  "List archival policies for a workspace",
  {
    workspace_id: z.string(),
    enabled: z.boolean().optional(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, enabled, namespace }) => {
    const { listArchivalPolicies } = await import("../lib/archival-policies.js");
    return text(await listArchivalPolicies(sql, workspace_id, {
      enabled: enabled ?? undefined,
      namespace: namespace ?? undefined,
    }));
  },
);

server.tool(
  "memory_execute_archival",
  "Execute archival policies — archive memories matching policy criteria",
  {
    workspace_id: z.string(),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ workspace_id, dry_run }) => {
    const { executeArchivalPolicies } = await import("../lib/archival-policies.js");
    return text(await executeArchivalPolicies(sql, workspace_id));
  },
);

server.tool(
  "memory_get_archival_history",
  "Get archival history for a workspace",
  {
    workspace_id: z.string(),
    limit: z.number().int().optional().default(50),
  },
  async ({ workspace_id, limit }) => {
    const { listArchivalHistory } = await import("../lib/archival-policies.js");
    return text(await listArchivalHistory(sql, workspace_id, limit));
  },
);


// ─── Memory Boost ─────────────────────────────────────────────────────────────

server.tool(
  "memory_boost",
  "Temporarily boost a memory's importance to resist decay",
  {
    memory_id: z.string(),
    boost_amount: z.number().optional().default(0.3),
    boost_ttl_seconds: z.number().int().optional().default(604800),
    reason: z.string().optional(),
  },
  async ({ memory_id, boost_amount, boost_ttl_seconds, reason }) => {
    const { boostMemory } = await import("../lib/memory-boost.js");
    return text(await boostMemory(sql, memory_id, boost_amount, boost_ttl_seconds, reason));
  },
);

server.tool(
  "memory_get_boost",
  "Get active boost for a memory",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    const { getMemoryBoost } = await import("../lib/memory-boost.js");
    const boost = await getMemoryBoost(sql, memory_id);
    return text(boost ?? { boost: null });
  },
);

server.tool(
  "memory_decay_boost",
  "Remove or reduce an active boost from a memory",
  { memory_id: z.string(), decay_by: z.number().optional().default(1) },
  async ({ memory_id, decay_by }) => {
    const { decayMemoryBoost } = await import("../lib/memory-boost.js");
    return text(await decayMemoryBoost(sql, memory_id, decay_by));
  },
);


// ─── Memory Linking ──────────────────────────────────────────────────────────

server.tool(
  "memory_link_memories",
  "Create a directed link between two memories (source → target)",
  {
    source_id: z.string().describe("Source memory ID"),
    target_id: z.string().describe("Target memory ID"),
    link_type: z.enum(["related", "follows", "depends_on", "引用", "expands", "contradicts"]).optional().default("related"),
    metadata: z.record(z.any()).optional(),
  },
  async ({ source_id, target_id, link_type, metadata }) => {
    const { linkMemories } = await import("../lib/memory-links.js");
    return text(await linkMemories(sql, source_id, target_id, link_type, metadata));
  },
);

server.tool(
  "memory_unlink_memories",
  "Remove a link between two memories",
  {
    source_id: z.string().describe("Source memory ID"),
    target_id: z.string().describe("Target memory ID"),
  },
  async ({ source_id, target_id }) => {
    const { unlinkMemories } = await import("../lib/memory-links.js");
    return text({ unlinked: await unlinkMemories(sql, source_id, target_id) });
  },
);

server.tool(
  "memory_get_outgoing_links",
  "Get all outgoing links from a memory (what it references)",
  {
    memory_id: z.string(),
    link_type: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ memory_id, link_type, limit }) => {
    const { getOutgoingLinks } = await import("../lib/memory-links.js");
    return text(await getOutgoingLinks(sql, memory_id, link_type, limit));
  },
);

server.tool(
  "memory_get_incoming_links",
  "Get all incoming links to a memory (what references it)",
  {
    memory_id: z.string(),
    link_type: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ memory_id, link_type, limit }) => {
    const { getIncomingLinks } = await import("../lib/memory-links.js");
    return text(await getIncomingLinks(sql, memory_id, link_type, limit));
  },
);

server.tool(
  "memory_traverse_graph",
  "Traverse memory graph starting from a memory, following links up to a max depth",
  {
    start_id: z.string().describe("Starting memory ID"),
    max_depth: z.number().int().positive().optional().default(3),
    direction: z.enum(["outgoing", "incoming", "both"]).optional().default("outgoing"),
    link_types: z.array(z.string()).optional(),
  },
  async ({ start_id, max_depth, direction, link_types }) => {
    const { traverseMemoryGraph } = await import("../lib/memory-links.js");
    return text(await traverseMemoryGraph(sql, start_id, max_depth, direction, link_types));
  },
);

server.tool(
  "memory_get_link_stats",
  "Get memory link statistics: link counts by type, most-linked memories, orphaned memories",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { getMemoryLinkStats } = await import("../lib/memory-links.js");
    return text(await getMemoryLinkStats(sql, workspace_id, namespace));
  },
);


// --- Memory links / relationships ---

server.tool(
  "memory_link_memories",
  "Create a link between two memories",
  {
    source_id: z.string().describe("Source memory UUID"),
    target_id: z.string().describe("Target memory UUID"),
    link_type: z.enum(["parent", "child", "related", "references", "derived_from"]).describe("Type of link"),
    label: z.string().optional().describe("Optional label for the link"),
  },
  async ({ source_id, target_id, link_type, label }) =>
    text(await linkMemories(sql, source_id, target_id, link_type, label)),
);

server.tool(
  "memory_unlink_memories",
  "Remove a link between two memories",
  {
    source_id: z.string().describe("Source memory UUID"),
    target_id: z.string().describe("Target memory UUID"),
    link_type: z.enum(["parent", "child", "related", "references", "derived_from"]).optional(),
  },
  async ({ source_id, target_id, link_type }) =>
    text({ deleted: await unlinkMemories(sql, source_id, target_id, link_type) }),
);

server.tool(
  "memory_get_outgoing_links",
  "Get all outgoing links from a memory (what this memory references)",
  {
    memory_id: z.string().describe("Memory UUID"),
    link_type: z.enum(["parent", "child", "related", "references", "derived_from"]).optional(),
  },
  async ({ memory_id, link_type }) =>
    text(await getOutgoingLinks(sql, memory_id, link_type)),
);

server.tool(
  "memory_get_incoming_links",
  "Get all incoming links to a memory (what references this memory)",
  {
    memory_id: z.string().describe("Memory UUID"),
    link_type: z.enum(["parent", "child", "related", "references", "derived_from"]).optional(),
  },
  async ({ memory_id, link_type }) =>
    text(await getIncomingLinks(sql, memory_id, link_type)),
);

server.tool(
  "memory_traverse_graph",
  "Traverse the memory graph N hops from a starting memory",
  {
    start_memory_id: z.string().describe("Starting memory UUID"),
    hops: z.number().int().min(1).max(5).optional().default(2),
    link_types: z.array(z.enum(["parent", "child", "related", "references", "derived_from"])).optional(),
  },
  async ({ start_memory_id, hops, link_types }) => {
    const visited = await traverseMemoryGraph(sql, start_memory_id, hops, link_types);
    return text(Object.fromEntries(visited));
  },
);

server.tool(
  "memory_search_across_namespaces",
  "Search memories across multiple namespaces simultaneously",
  {
    workspace_id: z.string(),
    query: z.string(),
    namespaces: z.array(z.string()).optional(),
    memory_types: z.array(MemoryTypeEnum).optional(),
    limit: z.number().optional().default(20),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, query, namespaces, memory_types, limit, offset }) =>
    text(await searchAcrossNamespaces(sql, { workspaceId: workspace_id, query, namespaces, memoryTypes: memory_types, limit, offset })),
);

server.tool(
  "memory_link_stats",
  "Get link count and type breakdown for a memory",
  { memory_id: z.string().describe("Memory UUID") },
  async ({ memory_id }) => text(await getMemoryLinkStats(sql, memory_id)),
);


// ─── Memory Namespaces ────────────────────────────────────────────────────────

server.tool(
  "memory_create_namespace",
  "Create a new memory namespace within a workspace",
  {
    workspace_id: z.string(),
    name: z.string().describe("Namespace name (unique per workspace)"),
    description: z.string().optional(),
    default_ttl_seconds: z.number().int().nonnegative().optional(),
    quota_max_memories: z.number().int().positive().optional(),
  },
  async ({ workspace_id, name, description, default_ttl_seconds, quota_max_memories }) => {
    const { createNamespace } = await import("../lib/memory-namespaces.js");
    return text(await createNamespace(sql, workspace_id, name, description, default_ttl_seconds, quota_max_memories));
  },
);

server.tool(
  "memory_list_namespaces",
  "List all namespaces in a workspace with stats",
  {
    workspace_id: z.string(),
    include_stats: z.boolean().optional().default(true),
  },
  async ({ workspace_id, include_stats }) => {
    const { listNamespaces } = await import("../lib/memory-namespaces.js");
    return text(await listNamespaces(sql, workspace_id, include_stats));
  },
);

server.tool(
  "memory_get_namespace_stats",
  "Get statistics for a namespace (total memories, type breakdown, avg importance, expired count)",
  { namespace: z.string() },
  async ({ namespace }) => {
    const { getNamespaceStats } = await import("../lib/memory-namespaces.js");
    return text(await getNamespaceStats(sql, namespace));
  },
);

server.tool(
  "memory_search_cross_namespace",
  "Search across multiple namespaces in a workspace simultaneously",
  {
    workspace_id: z.string(),
    text: z.string().describe("Search query"),
    namespaces: z.array(z.string()).min(1),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text"),
    limit: z.number().optional().default(20),
  },
  async ({ workspace_id, text, namespaces, mode, limit }) => {
    const { searchCrossNamespace } = await import("../lib/index.js");
    return text(await searchCrossNamespace(sql, workspace_id, text, namespaces, mode, limit));
  },
);

server.tool(
  "memory_delete_namespace",
  "Delete a namespace and optionally all its memories",
  {
    namespace: z.string(),
    delete_memories: z.boolean().optional().default(false),
  },
  async ({ namespace, delete_memories }) => {
    const { deleteNamespaceMemories } = await import("../lib/namespace-isolation.js");
    const { deleteNamespace } = await import("../lib/memory-namespaces.js");
    if (delete_memories) await deleteNamespaceMemories(sql, namespace);
    return text({ deleted: await deleteNamespace(sql, namespace) });
  },
);


// ─── Memory Recall Quality ─────────────────────────────────────────────────────

server.tool(
  "memory_record_recall",
  "Record a memory recall event for quality tracking",
  {
    memory_id: z.string(),
    success: z.boolean(),
    method: z.enum(["search", "direct", "recommend"]).optional().default("direct"),
    latency_ms: z.number().int().optional(),
  },
  async ({ memory_id, success, method, latency_ms }) => {
    const { recordMemoryRecall } = await import("../lib/recall.js");
    await recordMemoryRecall(sql, memory_id, success, latency_ms, method);
    return text({ ok: true });
  },
);

server.tool(
  "memory_get_quality_score",
  "Get quality score breakdown for a memory",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    const { getMemoryQualityScore } = await import("../lib/recall.js");
    return text(await getMemoryQualityScore(sql, memory_id));
  },
);


// ─── Memory Stats & Batch Operations ──────────────────────────────────────────

server.tool(
  "memory_get_stats_summary",
  "Get aggregate statistics for a workspace — total memories, breakdown by type, namespace counts, importance distribution, and TTL coverage",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const nsFilter = namespace ? sql`AND n.name = ${namespace}` : sql``;
    const [totals] = await sql`
      SELECT
        COUNT(DISTINCT m.id)::int AS total_memories,
        COUNT(DISTINCT m.collection_id)::int AS total_collections,
        COUNT(DISTINCT n.id)::int AS total_namespaces,
        AVG(m.importance)::float AS avg_importance,
        MIN(m.created_at) AS oldest_memory,
        MAX(m.updated_at) AS newest_memory
      FROM memory.memories m
      LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
      WHERE n.workspace_id = ${workspace_id} ${nsFilter}
    `;
    const byType = await sql`
      SELECT m.memory_type, COUNT(*)::int AS count, AVG(m.importance)::float AS avg_importance
      FROM memory.memories m
      LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
      WHERE n.workspace_id = ${workspace_id} ${nsFilter}
      GROUP BY m.memory_type
    `;
    const byNamespace = await sql`
      SELECT n.name, COUNT(m.id)::int AS memory_count, AVG(m.importance)::float AS avg_importance
      FROM memory.namespaces n
      LEFT JOIN memory.memories m ON m.namespace_id = n.id
      WHERE n.workspace_id = ${workspace_id} ${nsFilter}
      GROUP BY n.name
      ORDER BY memory_count DESC
    `;
    const [withTtl] = await sql`
      SELECT
        COUNT(CASE WHEN m.expires_at IS NOT NULL OR m.ttl_seconds > 0 THEN 1 END)::int AS memories_with_ttl,
        COUNT(CASE WHEN m.is_pinned THEN 1 END)::int AS pinned_count,
        COUNT(CASE WHEN m.importance > 0.7 THEN 1 END)::int AS high_importance_count
      FROM memory.memories m
      LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
      WHERE n.workspace_id = ${workspace_id} ${nsFilter}
    `;
    return text({ workspace_id, namespace: namespace ?? "all", totals, by_type: byType, by_namespace: byNamespace, ttl_coverage: withTtl });
  },
);

server.tool(
  "memory_batch_get",
  "Retrieve multiple memories by their IDs in a single call — more efficient than individual lookups",
  {
    workspace_id: z.string(),
    memory_ids: z.array(z.string()),
    include_links: z.boolean().optional().default(false),
  },
  async ({ workspace_id, memory_ids, include_links }) => {
    if (!memory_ids.length) return text({ memories: [], count: 0 });
    const memories = await sql`
      SELECT m.id, m.workspace_id, m.namespace_id, m.collection_id, m.content,
             m.summary, m.importance, m.memory_type, m.priority, m.metadata,
             m.is_pinned, m.created_at, m.updated_at, m.expires_at, m.ttl_seconds,
             n.name AS namespace
      FROM memory.memories m
      LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
      WHERE m.id IN ${sql(memory_ids)}
        AND n.workspace_id = ${workspace_id}
    `;
    let links: any[] = [];
    if (include_links) {
      const linkRows = await sql`
        SELECT ml.source_memory_id, ml.target_memory_id, ml.link_type, ml.strength
        FROM memory.memory_links ml
        WHERE ml.source_memory_id IN ${sql(memory_ids)}
      `;
      links = linkRows;
    }
    return text({ memories, count: memories.length, links: include_links ? links : undefined });
  },
);

server.tool(
  "memory_suggest_next",
  "Suggest memories most likely to be needed next based on recent recall patterns — uses access history and temporal locality",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    last_recalled_ids: z.array(z.string()).optional(),
    limit: z.number().optional().default(5),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, user_id, last_recalled_ids, limit, namespace }) => {
    // Get memories from the same namespaces/types as recently accessed ones
    let recencyFilter = sql`TRUE`;
    if (last_recalled_ids && last_recalled_ids.length > 0) {
      const [recent] = await sql`
        SELECT m.memory_type, m.namespace_id, COUNT(*)::int AS access_count
        FROM memory.memory_access_log mal
        JOIN memory.memories m ON m.id = mal.memory_id
        JOIN memory.namespaces n ON m.namespace_id = n.id
        WHERE mal.memory_id IN ${sql(last_recalled_ids)}
          AND n.workspace_id = ${workspace_id}
        GROUP BY m.memory_type, m.namespace_id
        ORDER BY access_count DESC
        LIMIT 3
      `;
      if (recent) {
        recencyFilter = sql`(m.memory_type = ${recent.memory_type} OR m.namespace_id = ${recent.namespace_id})`;
      }
    }
    const nsFilter = namespace ? sql`AND n.name = ${namespace}` : sql``;
    const userFilter = user_id ? sql`AND m.user_id = ${user_id}` : sql``;
    // Get high-importance, recently accessed memories not in the recall history
    const suggestions = await sql`
      SELECT m.id, m.content, m.summary, m.memory_type, m.importance,
             m.namespace_id, n.name AS namespace,
             COALESCE(ac.access_count, 0)::int AS recent_access_count,
             m.updated_at
      FROM memory.memories m
      LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS access_count
        FROM memory.memory_access_log mal
        WHERE mal.memory_id = m.id
          AND mal.accessed_at >= NOW() - INTERVAL '7 days'
      ) ac ON true
      WHERE n.workspace_id = ${workspace_id}
        AND m.is_archived = false
        AND m.is_pinned = false
        ${nsFilter}
        ${userFilter}
        ${last_recalled_ids && last_recalled_ids.length > 0 ? sql`AND m.id NOT IN ${sql(last_recalled_ids)}` : sql``}
        AND (${last_recalled_ids && last_recalled_ids.length > 0 ? recencyFilter : sql`TRUE`})
      ORDER BY ac.access_count DESC, m.importance DESC, m.updated_at DESC
      LIMIT ${limit ?? 5}
    `;
    return text({ suggestions, count: suggestions.length });
  },
);

server.tool(
  "memory_generate_handoff_summary",
  "Generate a comprehensive handoff summary of memories relevant to a topic for agent context transfer",
  {
    agent_id: z.string(),
    topic: z.string(),
    workspace_id: z.string(),
    max_memories: z.number().int().positive().optional().default(20),
    min_relevance_score: z.number().min(0).max(1).optional().default(0.3),
  },
  async ({ agent_id, topic, workspace_id, max_memories, min_relevance_score }) =>
    text(
      await generateMemoryHandoffSummary(sql, agent_id, topic, workspace_id, {
        maxMemories: max_memories,
        minRelevanceScore: min_relevance_score,
      }),
    ),
);

server.tool(
  "memory_transfer_context",
  "Transfer specific memories from one agent to another for cross-agent context sharing",
  {
    source_agent_id: z.string(),
    target_agent_id: z.string(),
    memory_ids: z.array(z.string()),
    reason: z.string().optional(),
    workspace_id: z.string(),
  },
  async ({ source_agent_id, target_agent_id, memory_ids, reason, workspace_id }) =>
    text(
      await transferMemoryContext(sql, source_agent_id, target_agent_id, memory_ids, reason),
    ),
);

server.tool(
  "memory_score_topic_relevance",
  "Score and rank memories by their relevance to a specific topic",
  {
    workspace_id: z.string(),
    topic: z.string(),
    limit: z.number().int().positive().optional().default(20),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, topic, limit, memory_type }) =>
    text(
      await scoreMemoriesByTopicRelevance(sql, workspace_id, topic, {
        limit,
        memoryType: memory_type,
      }),
    ),
);

server.tool(
  "memory_get_prioritized_for_agent",
  "Get prioritized memories for an agent based on topic relevance and recency",
  {
    agent_id: z.string(),
    workspace_id: z.string(),
    topic: z.string(),
    max_memories: z.number().int().positive().optional().default(10),
  },
  async ({ agent_id, workspace_id, topic, max_memories }) =>
    text(
      await getPrioritizedMemoriesForAgent(sql, agent_id, workspace_id, topic, max_memories),
    ),
);

// --- Memory Version Diff Tools ---
server.tool(
  "memory_get_version",
  "Get a specific version of a memory",
  {
    memory_id: z.string(),
    version_id: z.string(),
  },
  async ({ memory_id, version_id }) =>
    text(await getVersionDiff(sql, memory_id, version_id)),
);

server.tool(
  "memory_list_versions",
  "List all versions of a memory, newest first",
  {
    memory_id: z.string(),
    limit: z.number().int().positive().optional().default(20),
    offset: z.number().int().nonnegative().optional().default(0),
  },
  async ({ memory_id, limit, offset }) =>
    text(await listVersionDiffs(sql, memory_id, limit, offset)),
);

server.tool(
  "memory_diff_versions",
  "Compare two versions of a memory to show what changed",
  {
    memory_id: z.string(),
    from_version_id: z.string(),
    to_version_id: z.string(),
  },
  async ({ memory_id, from_version_id, to_version_id }) =>
    text(await diffMemoryVersions(sql, memory_id, from_version_id, to_version_id)),
);

server.tool(
  "memory_version_timeline",
  "Get a summary of all changes across a memory's lifetime",
  {
    memory_id: z.string(),
  },
  async ({ memory_id }) =>
    text(await getMemoryVersionTimeline(sql, memory_id)),
);

// --- Recall Analytics Tools ---
server.tool(
  "memory_record_recall",
  "Record a memory recall event for analytics",
  {
    memory_id: z.string(),
    user_id: z.string(),
    workspace_id: z.string(),
    recall_method: z.enum(["search", "direct", "auto", "link", "context"]).optional().default("direct"),
    relevance_score: z.number().min(0).max(1).optional(),
    recall_latency_ms: z.number().positive().optional(),
  },
  async ({ memory_id, user_id, workspace_id, recall_method, relevance_score, recall_latency_ms }) => {
    await recordRecall(sql, memory_id, user_id, workspace_id, {
      recallMethod: recall_method as any,
      relevanceScore: relevance_score,
      recallLatencyMs: recall_latency_ms,
    });
    return text({ recorded: true });
  },
);

server.tool(
  "memory_get_recall_stats",
  "Get recall statistics for a workspace",
  {
    workspace_id: z.string(),
    since: z.string().optional(),
  },
  async ({ workspace_id, since }) =>
    text(await getRecallStats(sql, workspace_id, since)),
);

server.tool(
  "memory_get_recall_popularity",
  "Get most frequently recalled memories (popularity ranking)",
  {
    workspace_id: z.string(),
    namespace_id: z.string().optional(),
    limit: z.number().int().positive().optional().default(50),
    since: z.string().optional(),
  },
  async ({ workspace_id, namespace_id, limit, since }) =>
    text(await getMemoryRecallPopularity(sql, workspace_id, { namespaceId: namespace_id, limit, since })),
);

server.tool(
  "memory_get_recall_trend",
  "Get recall trend over time (daily buckets)",
  {
    workspace_id: z.string(),
    buckets: z.number().int().positive().optional().default(30),
  },
  async ({ workspace_id, buckets }) =>
    text(await getRecallTrend(sql, workspace_id, buckets)),
);

server.tool(
  "memory_find_recall_mismatches",
  "Find memories with high recall but low relevance",
  {
    workspace_id: z.string(),
    min_recalls: z.number().int().positive().optional().default(10),
  },
  async ({ workspace_id, min_recalls }) =>
    text(await findRecallMismatches(sql, workspace_id, min_recalls)),
);

server.tool(
  "memory_record_recall_miss",
  "Record a recall miss (query that found no good results)",
  {
    query_text: z.string(),
    user_id: z.string(),
    workspace_id: z.string(),
    namespace_id: z.string().optional(),
  },
  async ({ query_text, user_id, workspace_id, namespace_id }) => {
    await recordRecallMiss(sql, query_text, user_id, workspace_id, namespace_id);
    return text({ recorded: true });
  },
);

server.tool(
  "memory_get_recall_miss_patterns",
  "Get common queries that fail to find good results",
  {
    workspace_id: z.string(),
    limit: z.number().int().positive().optional().default(20),
  },
  async ({ workspace_id, limit }) =>
    text(await getRecallMissPatterns(sql, workspace_id, limit)),
);

server.tool(
  "memory_get_recall_heatmap",
  "Get recall heatmap (which hours/days have most recalls)",
  {
    workspace_id: z.string(),
    since: z.string().optional(),
  },
  async ({ workspace_id, since }) =>
    text(await getRecallHeatmap(sql, workspace_id, since)),
);


// --- Memory templates ---

server.tool(
  "memory_create_template",
  "Create a reusable memory template with {{variable}} placeholders",
  {
    workspace_id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    content_template: z.string(),
    variables: z.array(z.string()).optional(),
    default_memory_type: MemoryTypeEnum.optional(),
    default_priority: z.number().optional(),
  },
  async ({ workspace_id, name, description, content_template, variables, default_memory_type, default_priority }) =>
    text(await createMemoryTemplate(sql, {
      workspaceId: workspace_id,
      name,
      description,
      contentTemplate: content_template,
      variables,
      defaultMemoryType: default_memory_type,
      defaultPriority: default_priority,
    })),
);

server.tool(
  "memory_render_template",
  "Render a memory template by ID with variable substitutions",
  {
    template_id: z.string(),
    variables: z.record(z.string()),
  },
  async ({ template_id, variables }) => {
    const result = await renderMemoryTemplateById(sql, template_id, variables);
    return text(result ?? { error: "Template not found" });
  },
);

server.tool(
  "memory_list_templates",
  "List memory templates for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, user_id, limit }) =>
    text(await listMemoryTemplates(sql, workspace_id, { userId: user_id, limit })),
);

server.tool(
  "memory_update_template",
  "Update a memory template",
  {
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    content_template: z.string().optional(),
    variables: z.array(z.string()).optional(),
    default_memory_type: MemoryTypeEnum.optional(),
    default_priority: z.number().optional(),
  },
  async ({ id, ...updates }) => {
    const result = await updateMemoryTemplate(sql, id, {
      name: updates.name,
      description: updates.description,
      contentTemplate: updates.content_template,
      variables: updates.variables,
      defaultMemoryType: updates.default_memory_type,
      defaultPriority: updates.default_priority,
    });
    return text(result ?? { error: "Template not found" });
  },
);

server.tool(
  "memory_delete_template",
  "Delete a memory template",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteMemoryTemplate(sql, id) }),
);

server.tool(
  "memory_get_template",
  "Get a memory template by ID",
  { id: z.string() },
  async ({ id }) => {
    const template = await getMemoryTemplate(sql, id);
    return text(template ?? { error: "Template not found" });
  },
);

server.tool(
  "memory_render_template_string",
  "Render a template string by substituting {{variable}} placeholders (does not use DB)",
  {
    content_template: z.string().describe("Template string with {{variable}} placeholders"),
    variables: z.record(z.string()).describe("Key-value pairs to substitute"),
  },
  ({ content_template, variables }) => {
    const rendered = renderMemoryTemplate(content_template, variables);
    return text(rendered);
  },
);


// ─── Memory Timeline ─────────────────────────────────────────────────────────

server.tool(
  "memory_get_timeline",
  "Get a chronological timeline of memories for a workspace (newest first)",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    namespace: z.string().optional(),
    start_date: z.string().datetime().optional(),
    end_date: z.string().datetime().optional(),
    limit: z.number().optional().default(100),
  },
  async ({ workspace_id, user_id, namespace, start_date, end_date, limit }) => {
    const { getMemoryTimeline } = await import("../lib/index.js");
    return text(await getMemoryTimeline(sql, workspace_id, user_id, namespace, start_date ? new Date(start_date) : undefined, end_date ? new Date(end_date) : undefined, limit));
  },
);

server.tool(
  "memory_get_before",
  "Get memories created before a given timestamp (pagination backward through time)",
  {
    workspace_id: z.string(),
    before: z.string().datetime(),
    limit: z.number().optional().default(50),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, before, limit, namespace }) => {
    const { getMemoriesBefore } = await import("../lib/index.js");
    return text(await getMemoriesBefore(sql, workspace_id, new Date(before), limit, namespace));
  },
);

server.tool(
  "memory_get_recent",
  "Get the most recently created memories",
  {
    workspace_id: z.string(),
    limit: z.number().optional().default(20),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, limit, namespace }) => {
    const { getRecentMemories } = await import("../lib/index.js");
    return text(await getRecentMemories(sql, workspace_id, limit, namespace));
  },
);


// ─── Memory Type Queries ─────────────────────────────────────────────────────

server.tool(
  "memory_query_by_type",
  "Query memories of a specific type (episodic, semantic, procedural, context)",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
    user_id: z.string().optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, memory_type, user_id, limit, offset }) => {
    const { queryTypedMemories } = await import("../lib/memory-type-queries.js");
    return text(await queryTypedMemories(sql, workspace_id, memory_type, { userId: user_id, limit, offset }));
  },
);

server.tool(
  "memory_get_type_distribution",
  "Get distribution of memory types in a workspace (counts, percentages, avg importance per type)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { getMemoryTypeDistribution } = await import("../lib/memory-type-queries.js");
    return text(await getMemoryTypeDistribution(sql, workspace_id, namespace));
  },
);

server.tool(
  "memory_count_by_type",
  "Get memory counts broken down by type",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { countMemoriesByType } = await import("../lib/memory-type-queries.js");
    return text(await countMemoriesByType(sql, workspace_id, namespace));
  },
);

server.tool(
  "memory_archive_by_type",
  "Archive all memories of a given type (set is_archived flag without deleting)",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
    reason: z.string().optional(),
  },
  async ({ workspace_id, memory_type, reason }) => {
    const { archiveMemoriesByType } = await import("../lib/memory-type-queries.js");
    return text({ archived: await archiveMemoriesByType(sql, workspace_id, memory_type, reason) });
  },
);


// --- Memory type query tools ---

server.tool(
  "memory_query_episodic",
  "Query episodic memories (recency-weighted, newest first)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    collection_id: z.string().optional(),
    since_hours: z.number().int().positive().optional(),
    max_results: z.number().int().positive().optional().default(100),
    importance_threshold: z.number().min(0).max(1).optional(),
    include_pinned: z.boolean().optional().default(false),
  },
  async (opts) => {
    const memories = await queryEpisodicMemories(sql, opts.workspace_id, opts);
    return text({ memories });
  },
);

server.tool(
  "memory_query_semantic",
  "Query semantic memories (importance-weighted, similarity-ordered)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    collection_id: z.string().optional(),
    importance_threshold: z.number().min(0).max(1).optional(),
    max_results: z.number().int().positive().optional().default(100),
    include_pinned: z.boolean().optional().default(false),
  },
  async (opts) => {
    const memories = await querySemanticMemories(sql, opts.workspace_id, opts);
    return text({ memories });
  },
);

server.tool(
  "memory_query_procedural",
  "Query procedural memories (step-sequence, instruction-ordered)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    collection_id: z.string().optional(),
    max_results: z.number().int().positive().optional().default(100),
    include_pinned: z.boolean().optional().default(false),
  },
  async (opts) => {
    const memories = await queryProceduralMemories(sql, opts.workspace_id, opts);
    return text({ memories });
  },
);

server.tool(
  "memory_query_context",
  "Query context memories (ephemeral, newest-first, short TTL)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    collection_id: z.string().optional(),
    max_results: z.number().int().positive().optional().default(50),
    max_age_seconds: z.number().int().positive().optional(),
  },
  async (opts) => {
    const memories = await queryContextMemories(sql, opts.workspace_id, opts);
    return text({ memories });
  },
);

server.tool(
  "memory_get_type_distribution",
  "Get memory type distribution for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const distribution = await getMemoryTypeDistribution(sql, workspace_id);
    return text({ distribution });
  },
);

server.tool(
  "memory_count_by_type_in_namespace",
  "Count memories by type in a namespace",
  { namespace_id: z.string() },
  async ({ namespace_id }) => {
    const counts = await countMemoriesByType(sql, namespace_id);
    return text({ counts });
  },
);

server.tool(
  "memory_archive_by_type",
  "Archive memories of a specific type older than threshold",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
    older_than_seconds: z.number().int().positive(),
  },
  async ({ workspace_id, memory_type, older_than_seconds }) => {
    const archived = await archiveMemoriesByType(sql, workspace_id, memory_type, older_than_seconds);
    return text({ archived, memoryType: memory_type });
  },
);

server.tool(
  "memory_expiry_stats",
  "Get memory expiry statistics broken down by namespace and type",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => {
    const stats = await getMemoryExpiryStats(sql, workspace_id);
    return text({ stats });
  },
);

server.tool(
  "memory_set_namespace_default_ttl",
  "Set the default TTL for a namespace",
  {
    workspace_id: z.string(),
    namespace: z.string(),
    ttl_seconds: z.number().int().min(0).nullable(),
  },
  async ({ workspace_id, namespace, ttl_seconds }) => {
    await setNamespaceDefaultTTL(sql, workspace_id, namespace, ttl_seconds);
    return text({ workspace_id, namespace, ttl_seconds });
  },
);

server.tool(
  "memory_get_expiring",
  "Get memories that are expiring within a given time window",
  {
    workspace_id: z.string(),
    within_seconds: z.number().int().positive(),
    limit: z.number().int().positive().optional().default(100),
  },
  async ({ workspace_id, within_seconds, limit }) => {
    const memories = await getExpiringMemories(sql, workspace_id, within_seconds, limit);
    return text({ expiring_memories: memories, count: memories.length });
  },
);

server.tool(
  "memory_namespace_analytics",
  "Get detailed analytics for a namespace including storage usage and access patterns",
  {
    workspace_id: z.string(),
    namespace: z.string(),
  },
  async ({ workspace_id, namespace }) => {
    const analytics = await getNamespaceAnalytics(sql, workspace_id, namespace);
    return text({ analytics });
  },
);

server.tool(
  "memory_search_cross_namespace",
  "Search for memories across multiple namespaces",
  {
    workspace_id: z.string(),
    query: z.string(),
    namespaces: z.array(z.string()).optional(),
    memory_types: z.array(MemoryTypeEnum).optional(),
    limit: z.number().int().positive().optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
  },
  async ({ workspace_id, query, namespaces, memory_types, limit, offset }) => {
    const results = await searchAcrossNamespaces(sql, {
      workspaceId: workspace_id,
      query,
      namespaces,
      memoryTypes: memory_types,
      limit,
      offset,
    });
    return text({ results, count: results.length });
  },
);

server.tool(
  "memory_type_breakdown",
  "Get a breakdown of memories by type including storage estimates and importance metrics",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => {
    const breakdown = await getMemoryTypeBreakdown(sql, workspace_id);
    return text({ breakdown });
  },
);

server.tool(
  "memory_suggest_type",
  "Suggest the best memory type for a piece of content based on its characteristics",
  {
    content: z.string(),
    metadata: z.record(z.any()).optional(),
  },
  async ({ content, metadata }) => {
    const suggested = suggestMemoryType(content, metadata);
    return text({ suggested_type: suggested });
  },
);

server.tool(
  "memory_migrate_type",
  "Migrate all memories of one type to another type for a workspace",
  {
    workspace_id: z.string(),
    from_type: MemoryTypeEnum,
    to_type: MemoryTypeEnum,
  },
  async ({ workspace_id, from_type, to_type }) => {
    const migrated = await migrateMemoryType(sql, workspace_id, from_type, to_type);
    return text({ migrated_count: migrated, from_type, to_type });
  },
);

// TTL extension and refresh tools
server.tool(
  "memory_extend_ttl",
  "Extend the TTL of a specific memory",
  {
    memory_id: z.string(),
    additional_seconds: z.number().int().positive(),
  },
  async ({ memory_id, additional_seconds }) => {
    const extended = await extendMemoryTTL(sql, memory_id, additional_seconds);
    return text({ extended, memoryId: memory_id, additionalSeconds: additional_seconds });
  },
);

server.tool(
  "memory_refresh_ttl",
  "Refresh the TTL of a memory to its original duration",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    const refreshed = await refreshMemoryTTL(sql, memory_id);
    return text({ refreshed, memoryId: memory_id });
  },
);

server.tool(
  "memory_refresh_hot_ttl",
  "Refresh TTL for a hot (frequently accessed) memory, extending its lifetime",
  {
    workspace_id: z.string(),
    memory_id: z.string(),
    boost_seconds: z.number().int().positive().optional(),
  },
  async ({ workspace_id, memory_id, boost_seconds }) => {
    const refreshed = await refreshTTLForHotMemory(sql, workspace_id, memory_id, boost_seconds);
    return text({ refreshed, memoryId: memory_id });
  },
);

// Memory type management tools
server.tool(
  "memory_get_memories_by_type",
  "Get all memories of a specific type in a collection",
  {
    collection_id: z.string(),
    memory_type: MemoryTypeEnum,
    limit: z.number().int().positive().max(500).optional().default(100),
    offset: z.number().int().min(0).optional().default(0),
  },
  async ({ collection_id, memory_type, limit, offset }) => {
    const memories = await getMemoriesByType(sql, collection_id, memory_type, { limit, offset });
    return text({ memories, count: memories.length });
  },
);

server.tool(
  "memory_set_memory_expiry",
  "Set a custom expiry time for a specific memory",
  {
    memory_id: z.string(),
    expires_at: z.string().datetime().nullable(),
  },
  async ({ memory_id, expires_at }) => {
    await setMemoryExpiry(sql, memory_id, expires_at ? new Date(expires_at) : null);
    return text({ memoryId: memory_id, expiresAt: expires_at });
  },
);

server.tool(
  "memory_clear_expiry",
  "Clear the custom expiry on a memory (revert to type-based TTL)",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    await clearMemoryExpiry(sql, memory_id);
    return text({ memoryId: memory_id, cleared: true });
  },
);

server.tool(
  "memory_get_ttl_stats",
  "Get tiered TTL statistics for a workspace (hot/warm/cold tier breakdown)",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const stats = await getTTLStats(sql, workspace_id);
    return text({ stats });
  },
);

// TTL bulk operations
server.tool(
  "memory_touch_many",
  "Refresh TTL for multiple memories at once (bulk touch without returning values)",
  {
    memory_ids: z.array(z.string()).describe("Memory UUIDs to refresh"),
    ttl_seconds: z.number().int().positive().optional().describe("Override TTL in seconds"),
  },
  async ({ memory_ids, ttl_seconds }) => {
    let touched = 0;
    for (const id of memory_ids) {
      const ok = ttl_seconds
        ? await refreshMemoryTTL(sql, id)
        : await refreshTTLForHotMemory(sql, id, id);
      if (ok) touched++;
    }
    return text({ touched, total: memory_ids.length });
  },
);

server.tool(
  "memory_evict_least_valuable",
  "Evict the least valuable memories from a collection to make room for new ones",
  {
    collection_id: z.string().describe("Collection UUID"),
    count: z.number().int().positive().optional().default(1).describe("Number of memories to evict"),
  },
  async ({ collection_id, count }) => {
    const evicted = await evictLeastValuable(sql, collection_id, count);
    return text({ evicted, count: evicted.length, ids: evicted.map((m: any) => m.id) });
  },
);

server.tool(
  "memory_get_hot_spots",
  "Find the memory hotspots (most frequently accessed regions) in a workspace",
  {
    workspace_id: z.string(),
    limit: z.number().int().positive().optional().default(10),
  },
  async ({ workspace_id, limit }) => {
    const spots = await getMemoryHotspots(sql, workspace_id, limit);
    return text({ spots, count: spots.length });
  },
);

// Single memory operations
server.tool(
  "memory_get",
  "Get a single memory by ID",
  { id: z.string().describe("Memory ID") },
  async ({ id }) => text(await getMemory(sql, id)),
);

// Embedding utilities
server.tool(
  "memory_generate_embedding",
  "Generate a vector embedding for text content (for semantic search)",
  {
    text: z.string().describe("Text content to embed"),
    model: z.string().optional().describe("Embedding model to use"),
  },
  async ({ text, model }) => {
    const embedding = await generateEmbedding(text, model);
    return text({ embedding, dimensions: embedding.length });
  },
);

server.tool(
  "memory_has_embedding_key",
  "Check if an embedding API key is configured",
  {},
  async () => text({ hasKey: hasEmbeddingKey() }),
);

// Cross-namespace search
server.tool(
  "memory_search_cross_namespace",
  "Search memories across multiple namespaces in a single query",
  {
    workspace_id: z.string(),
    text: z.string(),
    namespaces: z.array(z.string()).min(1).max(10),
    limit: z.number().optional().default(20),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("hybrid"),
  },
  async ({ workspace_id, text, namespaces, limit, mode }) =>
    text(await searchCrossNamespace(sql, workspace_id, namespaces, text, mode, limit)),
);

// Bulk memory operations
server.tool(
  "memory_bulk_store",
  "Store multiple memories in a single batch call",
  {
    memories: z.array(z.object({
      workspace_id: z.string(),
      user_id: z.string().optional(),
      collection_id: z.string().optional(),
      content: z.string(),
      summary: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      memory_type: MemoryTypeEnum.optional(),
      namespace: z.string().optional(),
      metadata: z.record(z.any()).optional(),
    })).min(1).max(100),
  },
  async ({ memories }) =>
    text(await bulkStoreMemories(sql, memories as any)),
);

server.tool(
  "memory_bulk_update",
  "Update multiple memories in a single batch call",
  {
    updates: z.array(z.object({
      id: z.string(),
      content: z.string().optional(),
      summary: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      metadata: z.record(z.any()).optional(),
    })).min(1).max(100),
  },
  async ({ updates }) =>
    text(await bulkUpdateMemories(sql, updates as any)),
);

server.tool(
  "memory_bulk_delete",
  "Delete multiple memories in a single batch call",
  {
    ids: z.array(z.string()).min(1).max(100),
    workspace_id: z.string(),
  },
  async ({ ids, workspace_id }) =>
    text({ deleted: await bulkDeleteMemories(sql, ids, workspace_id) }),
);

// TTL tiered operations
server.tool(
  "memory_apply_soft_expire",
  "Apply soft-expiry markers to memories past their TTL but not yet purged",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    grace_period_seconds: z.number().optional().default(86400),
  },
  async ({ workspace_id, namespace, grace_period_seconds }) =>
    text({ applied: await applySoftExpire(sql, workspace_id, namespace, grace_period_seconds) }),
);

server.tool(
  "memory_purge_soft_expired",
  "Permanently delete memories that have been soft-expired",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) =>
    text({ deleted: await purgeSoftExpired(sql, workspace_id, namespace) }),
);

// Typed memory queries
server.tool(
  "memory_query_episodic",
  "Query episodic memories (user experiences, events, conversations) for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, user_id, since, until, limit }) =>
    text(await queryEpisodicMemories(sql, workspace_id, user_id, { since: since ? new Date(since) : undefined, until: until ? new Date(until) : undefined, limit })),
);

server.tool(
  "memory_query_semantic",
  "Query semantic memories (facts, knowledge, learned information) for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(50),
    min_importance: z.number().min(0).max(1).optional(),
  },
  async ({ workspace_id, user_id, limit, min_importance }) =>
    text(await querySemanticMemories(sql, workspace_id, user_id, { limit, minImportance: min_importance })),
);

// Fast rerank
server.tool(
  "memory_rerank_fast",
  "Rerank memories using a lightweight algorithm (faster than full rerank)",
  {
    workspace_id: z.string(),
    query: z.string(),
    memory_ids: z.array(z.string()),
    top_k: z.number().int().positive().optional().default(10),
  },
  async ({ workspace_id, query, memory_ids, top_k }) =>
    text(await rerankMemoriesFast(sql, workspace_id, query, memory_ids, top_k)),
);

// Memory timeline
server.tool(
  "memory_timeline",
  "Get a timeline of memories for a user within a date range",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    since: z.string().datetime(),
    until: z.string().datetime().optional(),
    limit: z.number().optional().default(100),
  },
  async ({ workspace_id, user_id, since, until, limit }) =>
    text(await getMemoryTimeline(sql, workspace_id, user_id, new Date(since), until ? new Date(until) : undefined, limit)),
);


// ─── Memory-type Recall Strategies ─────────────────────────────────────────────

server.tool(
  "memory_recall_with_strategies",
  "Recall memories using type-specific scoring strategies — episodic uses recency, semantic uses importance, procedural uses exact match, context decays fast",
  {
    workspace_id: z.string(),
    query: z.string().optional(),
    memory_types: z.array(z.enum(["episodic", "semantic", "procedural", "context"])).optional(),
    limit: z.number().int().positive().optional().default(20),
    namespace: z.string().optional(),
    collection_id: z.string().optional(),
    min_importance: z.number().min(0).max(1).optional(),
  },
  async ({ workspace_id, query, memory_types, limit, namespace, collection_id, min_importance }) => {
    const { recallWithStrategies } = await import("../lib/memory-type-recall-strategies.js");
    return text(await recallWithStrategies(sql, {
      workspaceId: workspace_id,
      query: query ?? undefined,
      memoryTypes: memory_types ?? undefined,
      limit: limit ?? 20,
      namespace: namespace ?? undefined,
      collectionId: collection_id ?? undefined,
      minImportance: min_importance ?? undefined,
    }));
  },
);

server.tool(
  "memory_get_recall_breakdown",
  "Get breakdown of recall scores by memory type — shows count and avg/top scores per type",
  {
    workspace_id: z.string(),
    query: z.string().optional(),
  },
  async ({ workspace_id, query }) => {
    const { getRecallBreakdown } = await import("../lib/memory-type-recall-strategies.js");
    return text(await getRecallBreakdown(sql, workspace_id, query));
  },
);

server.tool(
  "memory_bulk_search",
  "Search memories with multiple queries in a single batch call — returns per-query results",
  {
    queries: z.array(z.object({
      text: z.string().describe("Search query text"),
      mode: z.enum(["semantic", "text", "hybrid"]).optional(),
      limit: z.number().int().positive().optional().default(5),
      namespace_id: z.string().optional(),
    })).describe("Array of search queries to execute"),
    workspace_id: z.string().describe("Workspace ID"),
  },
  async ({ queries, workspace_id }) => {
    const results = await Promise.all(
      queries.map((q, i) =>
        searchMemories(sql, {
          workspaceId: workspace_id,
          text: q.text,
          mode: q.mode ?? "semantic",
          limit: q.limit ?? 5,
          namespaceId: q.namespace_id,
        }).then(memories => ({ index: i, query: q.text, memories, count: memories.length }))
      )
    );
    return text({
      total_queries: queries.length,
      results,
      total_matches: results.reduce((sum, r) => sum + r.count, 0),
    });
  },
);

server.tool(
  "memory_workspace_dashboard",
  "Get a quick at-a-glance memory dashboard for a workspace — counts by type, namespace distribution, and health score",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_days: z.number().int().positive().optional().default(7).describe("Period in days for trend data"),
  },
  async ({ workspace_id, period_days }) => {
    const { getMemoryTrends, computeMemoryHealthScore } = await import("../lib/memory-analytics.js");
    const [typeDist, trends, health] = await Promise.all([
      getMemoryTypeDistribution(sql, workspace_id),
      getMemoryTrends(sql, workspace_id, period_days),
      computeMemoryHealthScore(sql, workspace_id),
    ]);

    const nsCounts = await sql`
      SELECT namespace_id, COUNT(*) as count
      FROM memories.memories
      WHERE workspace_id = ${workspace_id}
      GROUP BY namespace_id
    `;

    return text({
      workspace_id,
      period_days,
      total_memories: typeDist.reduce((s: number, t: { count: number }) => s + t.count, 0),
      by_type: typeDist,
      by_namespace: nsCounts.map((r: { namespace_id: string; count: string }) => ({
        namespace_id: r.namespace_id,
        count: parseInt(r.count, 10),
      })),
      trends,
      health,
    });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);

// ─── Memory Versioning ────────────────────────────────────────────────────────

server.tool(
  "memory_create_version",
  "Create a new version entry for a memory (call before updating to track history)",
  {
    memory_id: z.string(),
    content: z.string(),
    summary: z.string().optional(),
    importance: z.number().min(0).max(1),
    memory_type: z.string(),
    changed_by: z.string().optional(),
    change_reason: z.string().optional(),
  },
  async ({ memory_id, content, summary, importance, memory_type, changed_by, change_reason }) => {
    const { createMemoryVersion } = await import("../lib/memory-versioning.js");
    return text(await createMemoryVersion(sql, { memoryId: memory_id, content, summary, importance, memoryType: memory_type, changedBy: changed_by, changeReason: change_reason }));
  },
);

server.tool(
  "memory_get_versions",
  "Get all versions of a memory",
  {
    memory_id: z.string(),
    limit: z.number().optional().default(20),
  },
  async ({ memory_id, limit }) => {
    const { getMemoryVersions } = await import("../lib/memory-versioning.js");
    return text(await getMemoryVersions(sql, memory_id, limit));
  },
);

server.tool(
  "memory_restore_version",
  "Restore a memory to a previous version",
  {
    memory_id: z.string(),
    version_number: z.number().int().min(1),
    restored_by: z.string().optional(),
  },
  async ({ memory_id, version_number, restored_by }) => {
    const { restoreMemoryVersion } = await import("../lib/memory-versioning.js");
    return text(await restoreMemoryVersion(sql, memory_id, version_number, restored_by));
  },
);

server.tool(
  "memory_compare_versions",
  "Compare two versions of a memory",
  {
    memory_id: z.string(),
    version_a: z.number().int().min(1),
    version_b: z.number().int().min(1),
  },
  async ({ memory_id, version_a, version_b }) => {
    const { compareMemoryVersions } = await import("../lib/memory-versioning.js");
    return text(await compareMemoryVersions(sql, memory_id, version_a, version_b));
  },
);

server.tool(
  "memory_prune_versions",
  "Prune old versions keeping only the last N",
  {
    memory_id: z.string(),
    keep_last: z.number().optional().default(10),
  },
  async ({ memory_id, keep_last }) => {
    const { pruneMemoryVersions } = await import("../lib/memory-versioning.js");
    return text({ pruned: await pruneMemoryVersions(sql, memory_id, keep_last) });
  },
);


// ─── Namespace Analytics ───────────────────────────────────────────────────────

server.tool(
  "memory_get_namespace_analytics",
  "Get detailed analytics for a namespace — memory count, type breakdown, importance histogram, access patterns",
  {
    workspace_id: z.string(),
    namespace: z.string().describe("Namespace name"),
    period_hours: z.number().optional().default(720).describe("Look back window in hours (default 30 days)"),
  },
  async ({ workspace_id, namespace, period_hours }) => {
    const { getNamespaceAnalytics } = await import("../lib/memory-namespaces.js");
    return text(await getNamespaceAnalytics(sql, workspace_id, namespace, period_hours));
  },
);


// --- Namespace isolation and quota tools ---

server.tool(
  "memory_can_write_to_namespace",
  "Check if a workspace can write to a namespace within its quota",
  { namespace_id: z.string(), workspace_id: z.string() },
  async ({ namespace_id, workspace_id }) =>
    text(await canWriteToNamespace(sql, namespace_id, workspace_id)),
);

server.tool(
  "memory_can_read_from_namespace",
  "Check if a workspace can read from a namespace",
  { namespace_id: z.string(), workspace_id: z.string() },
  async ({ namespace_id, workspace_id }) => {
    const allowed = await canReadFromNamespace(sql, namespace_id, workspace_id);
    return text({ allowed });
  },
);

server.tool(
  "memory_get_namespace_quota",
  "Get detailed quota status for a namespace",
  { namespace_id: z.string() },
  async ({ namespace_id }) => {
    const quota = await getNamespaceQuota(sql, namespace_id);
    return text({ quota });
  },
);

server.tool(
  "memory_set_namespace_quota",
  "Set hard quota for a namespace",
  {
    namespace_id: z.string(),
    max_memories: z.number().int().positive().nullable(),
    max_collections: z.number().int().positive().nullable(),
    max_size_bytes: z.number().int().positive().nullable(),
    enforce_hard_limit: z.boolean().optional().default(false),
  },
  async ({ namespace_id, max_memories, max_collections, max_size_bytes, enforce_hard_limit }) => {
    await setNamespaceQuota(sql, namespace_id, {
      maxMemories: max_memories,
      maxCollections: max_collections,
      maxSizeBytes: max_size_bytes,
      enforceHardLimit: enforce_hard_limit,
    });
    return text({ ok: true });
  },
);

server.tool(
  "memory_refresh_namespace_count",
  "Recount current memory usage for a namespace and update its budget",
  {
    workspace_id: z.string(),
    namespace: z.string(),
  },
  async ({ workspace_id, namespace }) => {
    const count = await refreshNamespaceCount(sql, workspace_id, namespace);
    return text({ refreshed: true, count, workspace_id, namespace });
  },
);

server.tool(
  "memory_enforce_hard_quota",
  "Check if a namespace is at or over its hard quota limit (blocks writes if exceeded)",
  {
    namespace_id: z.string(),
    content_size_bytes: z.number().int().nonnegative().optional().default(0),
  },
  async ({ namespace_id, content_size_bytes }) =>
    text(await enforceNamespaceHardQuota(sql, namespace_id, content_size_bytes)),
);

server.tool(
  "memory_set_namespace_access_policy",
  "Set access policy (allowed/blocked workspaces, public read/write) for a namespace",
  {
    namespace_id: z.string(),
    allowed_workspace_ids: z.array(z.string()).optional(),
    blocked_workspace_ids: z.array(z.string()).optional(),
    public_read: z.boolean().optional().default(false),
    public_write: z.boolean().optional().default(false),
  },
  async ({ namespace_id, allowed_workspace_ids, blocked_workspace_ids, public_read, public_write }) => {
    await setNamespaceAccessPolicy(sql, namespace_id, {
      allowedWorkspaceIds: allowed_workspace_ids,
      blockedWorkspaceIds: blocked_workspace_ids,
      publicRead: public_read,
      publicWrite: public_write,
    });
    return text({ ok: true });
  },
);

server.tool(
  "memory_list_namespaces_with_quota",
  "List all namespaces for a workspace with quota information",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const namespaces = await listNamespacesWithQuota(sql, workspace_id);
    return text({ namespaces });
  },
);

server.tool(
  "memory_delete_namespace_memories",
  "Delete all memories in a namespace (hard delete)",
  { namespace_id: z.string() },
  async ({ namespace_id }) => {
    const deleted = await deleteNamespaceMemories(sql, namespace_id);
    return text({ deleted, namespaceId: namespace_id });
  },
);


// ─── Namespace Transfer ────────────────────────────────────────────────────────

server.tool(
  "memory_preview_transfer",
  "Preview what memories would be transferred between namespaces without actually transferring",
  {
    workspace_id: z.string(),
    source_namespace: z.string(),
    target_namespace: z.string(),
    collection_id: z.string().optional(),
    memory_type: z.string().optional(),
    min_importance: z.number().min(0).max(1).optional(),
    older_than_seconds: z.number().int().positive().optional(),
    newer_than_seconds: z.number().int().positive().optional(),
  },
  async ({
    workspace_id, source_namespace, target_namespace,
    collection_id, memory_type, min_importance,
    older_than_seconds, newer_than_seconds,
  }) => {
    const { previewTransfer } = await import("../lib/namespace-transfer.js");
    return text(await previewTransfer(sql, workspace_id, {
      sourceNamespace: source_namespace,
      targetNamespace: target_namespace,
      collectionId: collection_id ?? undefined,
      memoryType: memory_type ?? undefined,
      minImportance: min_importance ?? undefined,
      olderThanSeconds: older_than_seconds ?? undefined,
      newerThanSeconds: newer_than_seconds ?? undefined,
      deleteSource: false,
    }));
  },
);

server.tool(
  "memory_transfer_memories",
  "Move or copy memories between namespaces within a workspace",
  {
    workspace_id: z.string(),
    source_namespace: z.string(),
    target_namespace: z.string(),
    collection_id: z.string().optional(),
    memory_type: z.string().optional(),
    min_importance: z.number().min(0).max(1).optional(),
    older_than_seconds: z.number().int().positive().optional(),
    newer_than_seconds: z.number().int().positive().optional(),
    delete_source: z.boolean().optional().default(false),
    batch_size: z.number().int().positive().optional().default(100),
    preserve_importance: z.boolean().optional().default(true),
    preserve_ttl: z.boolean().optional().default(false),
  },
  async ({
    workspace_id, source_namespace, target_namespace,
    collection_id, memory_type, min_importance,
    older_than_seconds, newer_than_seconds,
    delete_source, batch_size, preserve_importance, preserve_ttl,
  }) => {
    const { transferMemories } = await import("../lib/namespace-transfer.js");
    return text(await transferMemories(sql, workspace_id, {
      sourceNamespace: source_namespace,
      targetNamespace: target_namespace,
      collectionId: collection_id ?? undefined,
      memoryType: memory_type ?? undefined,
      minImportance: min_importance ?? undefined,
      olderThanSeconds: older_than_seconds ?? undefined,
      newerThanSeconds: newer_than_seconds ?? undefined,
      deleteSource: delete_source ?? false,
      batchSize: batch_size ?? 100,
      preserveImportance: preserve_importance ?? true,
      preserveTTL: preserve_ttl ?? false,
    }));
  },
);

server.tool(
  "memory_consolidate_episodic_to_semantic",
  "Copy episodic memories older than a threshold into the semantic namespace for long-term storage",
  {
    workspace_id: z.string(),
    older_than_hours: z.number().int().positive().optional().default(24),
    target_namespace: z.string().optional().default("semantic"),
  },
  async ({ workspace_id, older_than_hours, target_namespace }) => {
    const { consolidateEpisodicToSemantic } = await import("../lib/namespace-transfer.js");
    return text(await consolidateEpisodicToSemantic(
      sql, workspace_id,
      older_than_hours ?? 24,
      target_namespace ?? "semantic",
    ));
  },
);


// --- Recall scoring ---

server.tool(
  "memory_record_recall",
  "Record a memory recall event (success or failure)",
  {
    memory_id: z.string(),
    success: z.boolean(),
    latency_ms: z.number().optional(),
    method: z.enum(["search", "direct", "recommend"]).optional().default("direct"),
  },
  async ({ memory_id, success, latency_ms, method }) => {
    await recordMemoryRecall(sql, memory_id, success, latency_ms, method);
    return text({ ok: true });
  },
);

server.tool(
  "memory_quality_score",
  "Get quality score (0-100) for a memory based on access frequency, recall success, TTL, freshness",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    const score = await getMemoryQualityScore(sql, memory_id);
    return text(score ?? { error: "Memory not found" });
  },
);

server.tool(
  "memory_quality_report",
  "Get quality breakdown for all memories in a workspace",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) =>
    text(await getMemoryQualityReport(sql, workspace_id, namespace)),
);


// --- Search reranking ---

server.tool(
  "memory_rerank_results",
  "Rerank memory search results using recency, importance, access frequency, and semantic similarity",
  {
    workspace_id: z.string(),
    query_text: z.string(),
    memory_ids: z.array(z.string()),
    recency_weight: z.number().optional().default(0.3),
    importance_weight: z.number().optional().default(0.3),
    frequency_weight: z.number().optional().default(0.2),
    semantic_weight: z.number().optional().default(0.2),
    limit: z.number().optional().default(20),
  },
  async ({
    workspace_id: _workspace_id, query_text, memory_ids,
    recency_weight, importance_weight, frequency_weight, semantic_weight, limit,
  }) =>
    text(await rerankMemories(sql, query_text, memory_ids, {
      recency_weight, importance_weight, frequency_weight, semantic_weight, limit,
    })),
);


// --- Time-filter tools ---

server.tool(
  "memory_time_range",
  "Get memories within a specific time range (absolute dates or relative periods)",
  {
    workspace_id: z.string(),
    start_time: z.string().datetime().optional(),
    end_time: z.string().datetime().optional(),
    period: z.enum(["last_hour", "last_day", "last_week", "last_month", "last_year"]).optional(),
    user_id: z.string().optional(),
    collection_id: z.string().optional(),
    namespace: z.string().optional(),
    memory_type: MemoryTypeEnum.optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, start_time, end_time, period, user_id, collection_id, namespace, memory_type, limit }) =>
    text(await getMemoriesInTimeRange(sql, {
      workspaceId: workspace_id,
      startTime: start_time ? new Date(start_time) : undefined,
      endTime: end_time ? new Date(end_time) : undefined,
      period,
      userId: user_id,
      collectionId: collection_id,
      namespace,
      memoryType: memory_type,
      limit,
    })),
);

server.tool(
  "memory_recent",
  "Get the most recently created memories (shorthand for time_range with last_day)",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(20),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, user_id, limit, memory_type }) =>
    text(await getRecentMemories(sql, workspace_id, { userId: user_id, limit, memoryType: memory_type })),
);

server.tool(
  "memory_get_memories_before",
  "Get memories created before a specific datetime — useful for historical lookups and 'what did the user know before X'",
  {
    workspace_id: z.string(),
    before_time: z.string().datetime().describe("Cutoff datetime — only return memories created before this time"),
    user_id: z.string().optional(),
    query: z.string().optional().describe("Optional text query to filter memories within the window"),
    limit: z.number().optional().default(20),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, before_time, user_id, query, limit, memory_type }) =>
    text(await getMemoriesBefore(sql, workspace_id, new Date(before_time), query, limit)),
);

server.tool(
  "memory_timeline",
  "Get a chronological timeline of memory activity for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    granularity: z.enum(["hour", "day", "week", "month"]).optional().default("day"),
    memory_type: MemoryTypeEnum.optional(),
    limit: z.number().optional().default(30),
  },
  async ({ workspace_id, user_id, granularity, memory_type, limit }) =>
    text(await getMemoryTimeline(sql, workspace_id, { userId: user_id, granularity, memoryType: memory_type, limit })),
);

server.tool(
  "memory_upsert_decay_rule",
  "Create or update a decay rule for a workspace/namespace/memory type combination",
  {
    workspace_id: z.string(),
    namespace: z.string().optional().default(""),
    memory_type: z.string().optional().default(""),
    decay_model: z.enum(["linear", "exponential", "logarithmic"]).optional(),
    initial_half_life_hours: z.number().optional(),
    min_importance: z.number().optional(),
    enabled: z.boolean().optional(),
  },
  async (opts) => text(await upsertDecayRule(sql, opts)),
);

server.tool(
  "memory_get_decay_rule",
  "Get the effective decay rule for a workspace (falls back to namespace, type, or global defaults)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional().default(""),
    memory_type: z.string().optional().default(""),
  },
  async ({ workspace_id, namespace, memory_type }) =>
    text(await getDecayRule(sql, workspace_id, { namespace, memoryType: memory_type })),
);

server.tool(
  "memory_compute_decayed_importance",
  "Compute the current importance of a memory after applying its decay rule",
  {
    workspace_id: z.string(),
    memory_id: z.string(),
    current_importance: z.number(),
    created_at: z.string().datetime(),
    namespace: z.string().optional().default(""),
    memory_type: z.string().optional().default(""),
  },
  async (opts) => text(await computeDecayedImportance(sql, opts)),
);

server.tool(
  "memory_list_decay_rules",
  "List all decay rules configured for a workspace",
  {
    workspace_id: z.string(),
    limit: z.number().optional().default(100),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, limit, offset }) =>
    text(await listDecayRules(sql, workspace_id, { limit, offset })),
);

server.tool(
  "memory_delete_decay_rule",
  "Delete a decay rule by ID",
  {
    workspace_id: z.string(),
    id: z.string(),
  },
  async ({ workspace_id, id }) => text(await deleteDecayRule(sql, workspace_id, id)),
);

server.tool(
  "memory_query_typed",
  "Query memories filtered by a specific memory type (episodic/semantic/procedural)",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum.describe("Type of memory to query"),
    query: z.string().optional(),
    limit: z.number().optional().default(20),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, memory_type, query, limit, offset }) =>
    text(await queryTypedMemories(sql, workspace_id, memory_type as any, { query, limit, offset })),
);

server.tool(
  "memory_migrate_memory_type",
  "Bulk-migrate all memories of one type to another type within a workspace",
  {
    workspace_id: z.string(),
    from_type: MemoryTypeEnum,
    to_type: MemoryTypeEnum,
  },
  async ({ workspace_id, from_type, to_type }) =>
    text({ migrated: await migrateMemoryType(sql, workspace_id, from_type as any, to_type as any) }),
);

server.tool(
  "memory_render_template_by_id",
  "Render a memory template by ID, substituting variables",
  {
    template_id: z.string(),
    variables: z.record(z.string()).describe("Map of variable name to value"),
  },
  async ({ template_id, variables }) => text(await renderMemoryTemplateById(sql, template_id, variables)),
);

server.tool(
  "memory_get_type_config",
  "Get the effective configuration for a memory type in a workspace",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
  },
  async ({ workspace_id, memory_type }) =>
    text(await getMemoryTypeConfig(sql, workspace_id, memory_type as any)),
);

server.tool(
  "memory_set_type_config",
  "Set a custom configuration for a memory type in a workspace",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
    default_ttl_seconds: z.number().nullable().optional(),
    auto_consolidate: z.boolean().optional(),
    consolidation_mode: z.enum(["summary_only", "delete_source", "archive"]).optional(),
    max_memories: z.number().nullable().optional(),
    importance_floor: z.number().optional(),
    decay_model: z.enum(["linear", "exponential", "logarithmic"]).optional(),
    half_life_hours: z.number().nullable().optional(),
    allow_boost: z.boolean().optional(),
    search_weight: z.number().optional(),
  },
  async (opts) => text(await setMemoryTypeConfig(sql, opts as any)),
);

server.tool(
  "memory_list_type_configs",
  "List all memory type configurations for a workspace",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => text(await listMemoryTypeConfigs(sql, workspace_id)),
);

server.tool(
  "memory_delete_type_config",
  "Delete a custom memory type configuration, reverting to defaults",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
  },
  async ({ workspace_id, memory_type }) =>
    text(await deleteMemoryTypeConfig(sql, workspace_id, memory_type as any)),
);

server.tool(
  "memory_create_namespace",
  "Create a new memory namespace within a workspace",
  {
    workspace_id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    default_ttl_seconds: z.number().nullable().optional(),
    default_memory_type: MemoryTypeEnum.optional(),
  },
  async (opts) => text(await createNamespace(sql, opts)),
);

server.tool(
  "memory_get_namespace",
  "Get a memory namespace by name",
  {
    workspace_id: z.string(),
    name: z.string(),
  },
  async ({ workspace_id, name }) => text(await getNamespace(sql, workspace_id, name)),
);

server.tool(
  "memory_delete_namespace",
  "Delete a memory namespace",
  {
    workspace_id: z.string(),
    name: z.string(),
  },
  async ({ workspace_id, name }) => text(await deleteNamespace(sql, workspace_id, name)),
);

server.tool(
  "memory_list_namespaces",
  "List all memory namespaces in a workspace",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => text(await listNamespaces(sql, workspace_id)),
);

server.tool(
  "memory_update_namespace",
  "Update a memory namespace's settings",
  {
    workspace_id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    default_ttl_seconds: z.number().nullable().optional(),
    default_memory_type: MemoryTypeEnum.optional(),
  },
  async (opts) => text(await updateNamespace(sql, opts as any)),
);

server.tool(
  "memory_rename_namespace",
  "Rename a memory namespace and update all associated memories",
  {
    workspace_id: z.string(),
    old_name: z.string(),
    new_name: z.string(),
  },
  async ({ workspace_id, old_name, new_name }) =>
    text(await renameNamespace(sql, workspace_id, old_name, new_name)),
);

server.tool(
  "memory_namespace_stats",
  "Get statistics for a memory namespace (counts by type, avg importance, pinned, expired)",
  {
    workspace_id: z.string(),
    name: z.string(),
  },
  async ({ workspace_id, name }) => text(await getNamespaceStats(sql, workspace_id, name)),
);


// ─── TTL Escalation ─────────────────────────────────────────────────────────────

server.tool(
  "memory_get_escalation_candidates",
  "Find memories expiring soon that qualify for TTL escalation based on importance, access, and links",
  {
    workspace_id: z.string(),
    window_hours: z.number().int().positive().optional().default(72),
  },
  async ({ workspace_id, window_hours }) => {
    const { getEscalationCandidates } = await import("../lib/ttl-escalation.js");
    return text(await getEscalationCandidates(sql, workspace_id, window_hours ?? 72));
  },
);

server.tool(
  "memory_escalate_memories",
  "Extend TTL for high-value memories approaching expiry",
  {
    workspace_id: z.string(),
    min_importance_score: z.number().min(0).max(1).optional().default(0.5),
    escalation_multiplier: z.number().positive().optional().default(2.0),
    max_ttl_seconds: z.number().int().positive().optional(),
    check_access_log: z.boolean().optional().default(false),
    access_log_hours_threshold: z.number().int().positive().optional().default(24),
    check_links: z.boolean().optional().default(false),
    dry_run: z.boolean().optional().default(false),
  },
  async ({
    workspace_id, min_importance_score, escalation_multiplier,
    max_ttl_seconds, check_access_log, access_log_hours_threshold,
    check_links, dry_run,
  }) => {
    const { escalateMemories } = await import("../lib/ttl-escalation.js");
    return text(await escalateMemories(sql, workspace_id, {
      minImportanceScore: min_importance_score ?? 0.5,
      escalationMultiplier: escalation_multiplier ?? 2.0,
      maxTTLSeconds: max_ttl_seconds ?? null,
      checkAccessLog: check_access_log ?? false,
      accessLogHoursThreshold: access_log_hours_threshold ?? 24,
      checkLinks: check_links ?? false,
      dryRun: dry_run ?? false,
    }));
  },
);

server.tool(
  "memory_get_escalation_stats",
  "Get TTL escalation stats for a workspace — memories in each value tier expiring soon",
  {
    workspace_id: z.string(),
    window_hours: z.number().int().positive().optional().default(72),
  },
  async ({ workspace_id, window_hours }) => {
    const { getEscalationStats } = await import("../lib/ttl-escalation.js");
    return text(await getEscalationStats(sql, workspace_id, window_hours ?? 72));
  },
);

server.tool(
  "memory_set_escalation_policy",
  "Set workspace-level TTL escalation policy",
  {
    workspace_id: z.string(),
    min_importance_score: z.number().min(0).max(1),
    escalation_multiplier: z.number().positive(),
    max_ttl_seconds: z.number().int().positive().nullable().optional(),
    check_access_log: z.boolean().optional().default(false),
    access_log_hours_threshold: z.number().int().positive().optional().default(24),
    check_links: z.boolean().optional().default(false),
  },
  async ({
    workspace_id, min_importance_score, escalation_multiplier,
    max_ttl_seconds, check_access_log, access_log_hours_threshold, check_links,
  }) => {
    const { setEscalationPolicy } = await import("../lib/ttl-escalation.js");
    await setEscalationPolicy(sql, workspace_id, {
      minImportanceScore: min_importance_score,
      escalationMultiplier: escalation_multiplier,
      maxTTLSeconds: max_ttl_seconds ?? null,
      checkAccessLog: check_access_log ?? false,
      accessLogHoursThreshold: access_log_hours_threshold ?? 24,
      checkLinks: check_links ?? false,
    });
    return text({ ok: true });
  },
);

server.tool(
  "memory_get_escalation_policy",
  "Get current TTL escalation policy for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const { getEscalationPolicy } = await import("../lib/ttl-escalation.js");
    return text(await getEscalationPolicy(sql, workspace_id));
  },
);


// --- TTL Sweeper tools ---

server.tool(
  "memory_start_ttl_sweeper",
  "Start the background TTL sweeper for automatic expired memory deletion",
  {
    interval_ms: z.number().int().positive().optional().default(60000),
  },
  async ({ interval_ms }) => {
    startTtlSweeper(() => sql, interval_ms);
    return text({ ok: true, message: `TTL sweeper started with interval ${interval_ms}ms` });
  },
);

server.tool(
  "memory_stop_ttl_sweeper",
  "Stop the background TTL sweeper",
  async () => {
    stopTtlSweeper();
    return text({ ok: true });
  },
);

server.tool(
  "memory_get_ttl_sweeper_stats",
  "Get TTL sweeper run statistics",
  async () => text(getTtlSweeperStats()),
);

server.tool(
  "memory_run_sweep",
  "Run a single TTL sweep for all expired memories",
  async () => {
    const deleted = await runSweep(sql);
    return text({ deleted, runAt: new Date() });
  },
);

server.tool(
  "memory_run_workspace_sweep",
  "Run TTL sweep for a specific workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const deleted = await runWorkspaceSweep(sql, workspace_id);
    return text({ deleted, workspaceId: workspace_id });
  },
);

server.tool(
  "memory_enforce_ttl_tier",
  "Enforce TTL tier for a specific memory type",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
    max_age_seconds: z.number().int().positive().nullable(),
  },
  async ({ workspace_id, memory_type, max_age_seconds }) => {
    const deleted = await enforceTtlTier(sql, workspace_id, memory_type, max_age_seconds);
    return text({ deleted, memoryType: memory_type });
  },
);

server.tool(
  "memory_evict_by_age",
  "Evict oldest non-pinned memories to make room for new ones (LRU-style)",
  {
    workspace_id: z.string(),
    max_memories: z.number().int().positive(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, max_memories, namespace }) => {
    const evicted = await evictByAge(sql, workspace_id, max_memories, namespace);
    return text({ evicted, workspaceId: workspace_id });
  },
);


// ─── TTL Tiered ───────────────────────────────────────────────────────────────

server.tool(
  "memory_ttl_stats",
  "Get tiered TTL statistics for a workspace: counts per tier (hot, warm, cold, frozen)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { getTtlStats } = await import("../lib/ttl-tiered.js");
    return text(await getTtlStats(sql, workspace_id, namespace));
  },
);

server.tool(
  "memory_purge_soft_expired",
  "Purge memories that have exceeded their soft TTL (extended expiry) but are not yet hard-deleted",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { purgeSoftExpired } = await import("../lib/ttl-tiered.js");
    return text({ purged: await purgeSoftExpired(sql, workspace_id, namespace) });
  },
);


// --- Workspace sharing ---

server.tool(
  "memory_share_to_workspace",
  "Share a memory to another workspace with given permissions",
  {
    memory_id: z.string(),
    target_workspace_id: z.string(),
    permissions: z.enum(["read", "write", "admin"]).optional().default("read"),
  },
  async ({ memory_id, target_workspace_id, permissions }) => {
    await shareMemoryToWorkspace(sql, memory_id, target_workspace_id, permissions);
    return text({ ok: true });
  },
);

server.tool(
  "memory_list_workspace",
  "List all memories shared to a workspace",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) =>
    text(await listWorkspaceMemories(sql, workspace_id, namespace)),
);

server.tool(
  "memory_revoke_workspace_access",
  "Revoke workspace access to a memory",
  {
    memory_id: z.string(),
    workspace_id: z.string(),
  },
  async ({ memory_id, workspace_id }) => {
    const revoked = await revokeWorkspaceMemoryAccess(sql, memory_id, workspace_id);
    return text({ revoked });
  },
);

server.tool(
  "memory_get_permissions",
  "Get which workspaces have access to a memory",
  { memory_id: z.string() },
  async ({ memory_id }) => text(await getMemoryPermissions(sql, memory_id)),
);



async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
