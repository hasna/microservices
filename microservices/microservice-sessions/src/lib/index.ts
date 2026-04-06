/**
 * @hasna/microservice-sessions — conversation and message management library.
 *
 * Usage in your app:
 *   import { migrate, createConversation, addMessage } from '@hasna/microservice-sessions'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const conv = await createConversation(sql, { workspace_id: '...', user_id: '...', title: 'My Chat' })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// Context window
export {
  type ContextWindow,
  estimateTokens,
  getContextWindow,
} from "./context.js";
// Context summarization
export {
  buildSummaryInput,
  markPriorAsSummarized,
  needsSummarization,
  storeContextSummary,
  getSummarizationHistory,
  estimateSummarizationSavings,
  type SummarizeOpts,
  type SummarizeResult,
} from "./context-summary.js";
// Conversations
export {
  archiveConversation,
  type Conversation,
  createConversation,
  deleteConversation,
  forkConversation,
  getConversation,
  getForkTree,
  getRootConversation,
  listChildForks,
  listConversations,
  setForkPinned,
  summarizeConversation,
  updateConversation,
  updateSummary,
} from "./conversations.js";
// Export
export { exportConversation } from "./export.js";
// Session replay export
export {
  exportSessionReplay,
  exportSessionDiff,
  exportSessionArchive,
  type ReplaySession,
  type ReplayMessage,
  type SessionDiffResult,
  type SessionArchive,
} from "./session-replay.js";
// Messages
export {
  addMessage,
  deleteMessage,
  getMessage,
  getMessages,
  type Message,
  pinMessage,
  searchMessages,
} from "./messages.js";

// Session summaries
export {
  getSessionSummary,
  listSessionSummaries,
  storeSessionSummary,
  summarizeSession,
  type SessionSummary,
  type SummarizeSessionResult,
} from "./session-summaries.js";

// Session forks & pins
export {
  forkSession,
  getSessionLineage,
  isSessionPinned,
  pinSession,
  unpinSession,
  type SessionLineageEntry,
} from "./session-forks.js";

// Session search
export {
  searchSessionsByMetadata,
  searchSessionsMessages,
  type MessageSearchMatch,
  type MetadataFilter,
} from "./session-search.js";

// Session analytics
export {
  getSessionStats,
  listActiveSessions,
  type ActiveSession,
  type SessionStats,
} from "./session-analytics.js";

// Session templates
export {
  createSessionFromTemplate,
  createSessionTemplate,
  deleteSessionTemplate,
  getPopularTemplates,
  getSessionTemplate,
  listSessionTemplates,
  renderSessionTemplate,
  updateSessionTemplate,
  type CreateTemplateInput,
  type RenderedTemplate,
  type SessionTemplate,
} from "./session-templates.js";

// Session snapshots
export {
  compareSnapshots,
  createSessionSnapshot,
  deleteSessionSnapshot,
  getSessionSnapshot,
  listSessionSnapshots,
  pruneOldSnapshots,
  restoreFromSnapshot,
  type SessionSnapshot,
  type SnapshotData,
} from "./session-snapshots.js";

// Session diff
export {
  diffSessions,
  findCommonAncestor,
  generateSessionDiffText,
  type DiffMessage,
  type SessionDiff,
} from "./session-diff.js";

// Session annotations
export {
  createAnnotation,
  deleteAllSessionAnnotations,
  deleteAnnotation,
  getAnnotation,
  getAnnotationStats,
  getMessageAnnotations,
  listSessionAnnotations,
  updateAnnotation,
  type AnnotationType,
  type SessionAnnotation,
} from "./session-annotations.js";

// Session retention
export {
  applyRetentionPolicy,
  deleteRetentionPolicy,
  getRetentionPolicy,
  getRetentionStats,
  listRetentionPolicies,
  setRetentionPolicyEnabled,
  upsertRetentionPolicy,
  type RetentionAction,
  type RetentionPolicy,
  type RetentionScope,
} from "./session-retention.js";

// Session branching
export {
  findMergeBase,
  getSessionAncestors,
  rebaseFork,
  transplantFork,
} from "./session-branching.js";
// Session tags
export {
  tagSession,
  untagSession,
  clearSessionTags,
  listSessionTags,
  listWorkspaceTags,
  findSessionsByTag,
  updateTagColor,
  bulkTagSessions,
  findOrphanTags,
  type SessionTag,
} from "./session-tags.js";
// Session bookmarks
export {
  bookmarkMessage,
  removeBookmark,
  listSessionBookmarks,
  isMessageBookmarked,
  countSessionBookmarks,
  clearSessionBookmarks,
  type SessionBookmark,
} from "./session-bookmarks.js";
// Session usage metrics
export {
  recordSessionTokens,
  recordResponseTime,
  getSessionMetrics,
  getTopTokenSessions,
  getWorkspaceUsageTotals,
  deleteSessionMetrics,
  type SessionMetrics,
} from "./session-metrics.js";
// Session importance scoring
export {
  type SessionImportance,
  getSessionImportance,
  computeAndStoreSessionImportance,
  listSessionsByImportance,
  listSessionsAtRisk,
  recomputeAllSessionImportance,
} from "./session-importance.js";
// Fork lifecycle management
export {
  type ForkLifecycle,
  type ForkLifecycleState,
  getForkLifecycle,
  initForkLifecycle,
  transitionForkState,
  archiveFork,
  deleteFork,
  promoteFork,
  orphanChildForks,
  recordForkAccess,
  listForksByState,
  listStaleOrphanedForks,
  getForkStats,
} from "./fork-lifecycle.js";
// Scheduled session archival
export {
  type ScheduledArchival,
  type ScheduledAction,
  type ScheduledStatus,
  createScheduledArchival,
  cancelScheduledArchival,
  getScheduledArchival,
  listDueArchivals,
  listPendingArchivalsForSession,
  startArchival,
  completeArchival,
  failArchival,
  processScheduledArchival,
  rescheduleArchival,
  scheduleArchivalsForPolicy,
  getArchivalStats,
} from "./session-scheduler.js";
// Retention policies
export {
  type RetentionPolicy,
  type RetentionAction,
  type RetentionTrigger,
  type RetentionPolicyResult,
  type RetentionHistoryEntry,
  createRetentionPolicy,
  listRetentionPolicyRules,
  executeRetentionPolicy,
  executeAllRetentionPolicies,
  getRetentionHistory,
} from "./session-retention-policies.js";
// Fork pinning
export {
  type ForkPin,
  pinFork,
  unpinFork,
  isForkPinned,
  getForkPin,
  getPinDetails,
  listPinnedForks,
  listPinnedForksByUser,
  countPinnedForks,
  bulkPinForks,
} from "./fork-pinning.js";
// Summary settings
export {
  type SummarySettings,
  type UpdateSummarySettingsOpts,
  getSummarySettings,
  updateSummarySettings,
  shouldAutoSummarize,
  deleteSummarySettings,
} from "./summary-settings.js";

// Session sharing (ACL)
export {
  type ShareRole,
  type SessionShare,
  type ShareResult,
  shareSession,
  revokeSessionShare,
  listSessionShares,
  listSharedWithMe,
  checkSessionAccess,
  bulkShareSession,
  listSessionsSharedByMe,
} from "./session-sharing.js";

// Content filtering (PII redaction)
export {
  type FilterPattern,
  type FilterMatch,
  type FilterResult,
  redactContent,
  redactMessages,
  detectSensitiveContent,
} from "./content-filter.js";

// Session merge (3-way merge)
export {
  type ThreeWayMergeOptions,
  type MergeConflict,
  type ThreeWayMergeResult,
  threeWayMerge,
} from "./session-merge.js";

// Session links (cross-service linking)
export {
  linkSessionToExternal,
  getSessionLinks,
  getSessionsByExternalId,
  getSessionsByExternalIds,
  deleteSessionLink,
  deleteAllSessionLinks,
  getLinkStatsByService,
  type SessionLink,
} from "./session-links.js";

// Session pivot tables (multi-dimensional analytics)
export {
  type PivotDimension,
  type PivotCell,
  type PivotTableResult,
  pivotSessions,
  crossTabSessions,
  getSessionDistribution,
} from "./session-pivot.js";

// Session duration analysis
export {
  type DurationBucket,
  type SessionDuration,
  type DurationInsight,
  recordSessionEnd,
  getSessionDuration,
  getDurationInsights,
  getDurationBuckets,
  detectDurationAnomalies,
} from "./session-duration.js";

// Session quality scoring
export {
  type SessionQualityScore,
  type SessionHealthReport,
  type SessionHealthIssue,
  calculateSessionQuality,
  checkSessionHealth,
  storeSessionQualityScore,
  listSessionsByQuality,
} from "./session-quality.js";

// Auto summarization
export {
  getSessionsNeedingSummarization,
  processAutoSummarization,
  getContextWindowFill,
  type AutoSummarizeResult,
  type ContextWindowFill,
} from "./auto-summarize.js";

// Branch comparison
export {
  compareBranches,
  listAllBranchPairs,
  type BranchComparison,
  type BranchPair,
} from "./branch-compare.js";
