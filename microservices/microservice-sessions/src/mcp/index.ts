#!/usr/bin/env bun
/**
 * MCP server for microservice-sessions.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { estimateTokens, getContextWindow } from "../lib/context.js";
import {
  archiveConversation,
  createConversation,
  deleteConversation,
  forkConversation,
  getConversation,
  listConversations,
  updateConversation,
  updateSummary,
} from "../lib/conversations.js";
import { exportConversation } from "../lib/export.js";
import {
  exportSessionReplay,
  exportSessionDiff,
  exportSessionArchive,
} from "../lib/session-replay.js";
import {
  addMessage,
  deleteMessage,
  getMessage,
  getMessages,
  pinMessage,
  searchMessages,
} from "../lib/messages.js";
import {
  forkSession,
  getSessionLineage,
  isSessionPinned,
  pinSession,
  unpinSession,
} from "../lib/session-forks.js";
import {
  searchSessionsByMetadata,
  searchSessionsMessages,
} from "../lib/session-search.js";
import {
  getSessionStats,
  listActiveSessions,
} from "../lib/session-analytics.js";
import {
  getSessionSummary,
  listSessionSummaries,
  storeSessionSummary,
  summarizeSession,
} from "../lib/session-summaries.js";
import {
  createSessionFromTemplate,
  createSessionTemplate,
  deleteSessionTemplate,
  getPopularTemplates,
  getSessionTemplate,
  listSessionTemplates,
  renderSessionTemplate,
  updateSessionTemplate,
} from "../lib/session-templates.js";
import {
  compareSnapshots,
  createSessionSnapshot,
  deleteSessionSnapshot,
  getSessionSnapshot,
  listSessionSnapshots,
  pruneOldSnapshots,
  restoreFromSnapshot,
} from "../lib/session-snapshots.js";
import {
  diffSessions,
  findCommonAncestor,
  generateSessionDiffText,
} from "../lib/session-diff.js";
import {
  createAnnotation,
  deleteAnnotation,
  deleteAllSessionAnnotations,
  getAnnotation,
  getMessageAnnotations,
  listSessionAnnotations,
  updateAnnotation,
} from "../lib/session-annotations.js";
import {
  applyRetentionPolicy,
  deleteRetentionPolicy,
  getRetentionPolicy,
  getRetentionStats,
  listRetentionPolicies,
  setRetentionPolicyEnabled,
  upsertRetentionPolicy,
} from "../lib/session-retention.js";
import {
  findMergeBase,
  getSessionAncestors,
  rebaseFork,
  transplantFork,
} from "../lib/session-branching.js";
import {
  tagSession,
  untagSession,
  clearSessionTags,
  listSessionTags,
  listWorkspaceTags,
  findSessionsByTag,
  updateTagColor,
  bulkTagSessions,
  findOrphanTags,
} from "../lib/session-tags.js";
import {
  bookmarkMessage,
  removeBookmark,
  listSessionBookmarks,
  isMessageBookmarked,
  countSessionBookmarks,
  clearSessionBookmarks,
} from "../lib/session-bookmarks.js";
import {
  recordSessionTokens,
  recordResponseTime,
  getSessionMetrics,
  getTopTokenSessions,
  getWorkspaceUsageTotals,
  deleteSessionMetrics,
} from "../lib/session-metrics.js";
import {
  pivotSessions,
  crossTabSessions,
  getSessionDistribution,
} from "../lib/session-pivot.js";
import {
  getDurationInsights,
  getDurationBuckets,
  detectDurationAnomalies,
  recordSessionEnd,
  getSessionDuration,
} from "../lib/session-duration.js";
import {
  calculateSessionQuality,
  checkSessionHealth,
  storeSessionQualityScore,
  listSessionsByQuality,
} from "../lib/session-quality.js";
import {
  computeAndStoreSessionImportance,
  getSessionImportance,
  listSessionsByImportance,
  listSessionsAtRisk,
  recomputeAllSessionImportance,
} from "../lib/session-importance.js";
import {
  archiveFork,
  deleteFork,
  getForkLifecycle,
  initForkLifecycle,
  listForksByState,
  listStaleOrphanedForks,
  orphanChildForks,
  promoteFork,
  recordForkAccess,
  transitionForkState,
  getForkStats,
} from "../lib/fork-lifecycle.js";
import {
  pinFork,
  unpinFork,
  isForkPinned,
  getForkPin,
  listPinnedForks,
  listPinnedForksByUser,
  bulkPinForks,
  countPinnedForks,
} from "../lib/fork-pinning.js";
import {
  getSummarySettings,
  updateSummarySettings,
  shouldAutoSummarize,
  deleteSummarySettings,
} from "../lib/summary-settings.js";
import {
  cancelScheduledArchival,
  createScheduledArchival,
  getArchivalStats,
  getScheduledArchival,
  listDueArchivals,
  listPendingArchivalsForSession,
  processScheduledArchival,
  rescheduleArchival,
  startArchival,
  completeArchival,
  failArchival,
  scheduleArchivalsForPolicy,
} from "../lib/session-scheduler.js";
import {
  createRetentionPolicy,
  executeRetentionPolicy,
  executeAllRetentionPolicies,
  getRetentionHistory,
  listRetentionPolicyRules,
} from "../lib/session-retention-policies.js";
import {
  linkSessionToExternal,
  getSessionLinks,
  getSessionsByExternalId,
  getSessionsByExternalIds,
  deleteSessionLink,
  deleteAllSessionLinks,
  getLinkStatsByService,
} from "../lib/session-links.js";
import {
  getSessionsNeedingSummarization,
  processAutoSummarization,
  getContextWindowFill,
} from "../lib/auto-summarize.js";
import {
  compareBranches,
  listAllBranchPairs,
} from "../lib/branch-compare.js";

const server = new Server(
  { name: "microservice-sessions", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "sessions_create_conversation",
      description: "Create a new conversation",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          title: { type: "string" },
          model: { type: "string" },
          system_prompt: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["workspace_id", "user_id"],
      },
    },
    {
      name: "sessions_list_conversations",
      description: "List conversations for a workspace and user",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          archived: { type: "boolean" },
          search: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id", "user_id"],
      },
    },
    {
      name: "sessions_list_active_sessions",
      description: "List currently active sessions (sessions with activity in the last hour) for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_pivot_sessions",
      description: "Run a multi-dimensional pivot table query on session data for analytics",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          dimensions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string", enum: ["hour", "day", "week", "month", "user_id", "model", "channel", "workspace_id"] },
                label: { type: "string" },
              },
              required: ["field", "label"],
            },
          },
          since: { type: "string" },
          until: { type: "string" },
          group_limit: { type: "number" },
        },
        required: ["workspace_id", "dimensions"],
      },
    },
    {
      name: "sessions_cross_tab_sessions",
      description: "Run a two-dimensional cross-tabulation (crosstab) query on session data",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          row_dim: { type: "string", enum: ["hour", "day", "week", "month", "user_id", "model", "channel", "workspace_id"] },
          col_dim: { type: "string", enum: ["hour", "day", "week", "month", "user_id", "model", "channel", "workspace_id"] },
          measure: { type: "string", enum: ["messages", "sessions", "tokens"] },
          since: { type: "string" },
          until: { type: "string" },
        },
        required: ["workspace_id", "row_dim", "col_dim"],
      },
    },
    {
      name: "sessions_get_duration_insights",
      description: "Get duration statistics and insights for sessions in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_get_duration_buckets",
      description: "Get session durations bucketed by length ranges",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          buckets: { type: "array", items: { type: "number" } },
          since: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_calculate_session_quality",
      description: "Calculate quality score for a session based on completion, depth, coherence, and engagement",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_check_session_health",
      description: "Run a health check on a session, detecting issues like stalls, repetition, token bloat",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_list_by_quality",
      description: "List sessions filtered by quality tier for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          tier: { type: "string", enum: ["excellent", "good", "fair", "poor"] },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_get_conversation",
      description: "Get a conversation by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "sessions_add_message",
      description: "Add a message to a conversation",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          role: {
            type: "string",
            enum: ["system", "user", "assistant", "tool"],
          },
          content: { type: "string" },
          name: { type: "string" },
          tool_calls: { type: "object" },
          tokens: { type: "number" },
          latency_ms: { type: "number" },
          model: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["conversation_id", "role", "content"],
      },
    },
    {
      name: "sessions_get_messages",
      description: "Get messages for a conversation",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          limit: { type: "number" },
          before: { type: "string" },
          after: { type: "string" },
          role: { type: "string" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_get_context_window",
      description:
        "Get messages that fit within a token budget for a conversation",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          max_tokens: { type: "number" },
        },
        required: ["conversation_id", "max_tokens"],
      },
    },
    {
      name: "sessions_search_messages",
      description: "Full-text search across messages in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          query: { type: "string" },
          conversation_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id", "query"],
      },
    },
    {
      name: "sessions_delete_conversation",
      description: "Delete a conversation and all its messages",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "sessions_archive_conversation",
      description: "Archive a conversation",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "sessions_fork_conversation",
      description:
        "Fork a conversation from a specific message, creating a new conversation with messages up to that point",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          from_message_id: { type: "string" },
          title: { type: "string", description: "Optional title for the forked conversation" },
          pin_fork: { type: "boolean", description: "Whether to pin the fork point" },
        },
        required: ["conversation_id", "from_message_id"],
      },
    },
    {
      name: "sessions_get_fork_tree",
      description: "Get the full fork tree (all descendants) of a conversation",
      inputSchema: {
        type: "object",
        properties: { conversation_id: { type: "string" } },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_get_root_conversation",
      description: "Get the root conversation of a fork tree",
      inputSchema: {
        type: "object",
        properties: { conversation_id: { type: "string" } },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_list_child_forks",
      description: "List direct child forks of a conversation",
      inputSchema: {
        type: "object",
        properties: { conversation_id: { type: "string" } },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_set_fork_pinned",
      description: "Pin or unpin a conversation fork",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, pinned: { type: "boolean" } },
        required: ["id", "pinned"],
      },
    },
    {
      name: "sessions_store_context_summary",
      description: "Store a generated summary for a conversation (after LLM summarization)",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          summary_text: { type: "string" },
          tokens_used: { type: "number" },
          keep_recent: { type: "number", description: "Messages to keep untouched (default 5)" },
        },
        required: ["conversation_id", "summary_text", "tokens_used"],
      },
    },
    {
      name: "sessions_build_summary_input",
      description: "Build prior-context text for LLM summarization",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          keep_recent: { type: "number", description: "Keep recent N messages (default 5)" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_get_summarization_history",
      description: "Get the summarization history for a conversation (count, total tokens saved, last summary)",
      inputSchema: {
        type: "object",
        properties: { conversation_id: { type: "string" } },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_estimate_summarization_savings",
      description: "Estimate how many tokens would be saved if a conversation were summarized now",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          keep_recent: { type: "number", description: "Keep recent N messages (default 5)" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_needs_summarization",
      description: "Detect if a conversation is approaching token limits and needs summarization",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          threshold: { type: "number", description: "Token threshold to trigger needs-summarization (default 6000)" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_mark_prior_as_summarized",
      description: "Mark the oldest N messages in a conversation as already summarized (no LLM call — manual标记)",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          count: { type: "number", description: "Number of oldest messages to mark (default: prior-count from last summary)" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_export_conversation",
      description: "Export a conversation as markdown or JSON",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          format: { type: "string", enum: ["markdown", "json"] },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_pin_message",
      description: "Toggle pin status on a message",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },

    // ── Feature 1: Session summarization ──────────────────────────────────────
    {
      name: "sessions_summarize_session",
      description: "Summarize a session's messages using text extraction and store the summary",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          max_length: { type: "number", description: "Max characters in the summary (default 2000)" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_get_session_summary",
      description: "Retrieve the latest stored summary for a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },

    // ── Feature 2: Session fork / pin ────────────────────────────────────────
    {
      name: "sessions_fork_session",
      description: "Fork a session into a new session under an optional new workspace",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          new_namespace: { type: "string", description: "Optional new workspace_id for the fork" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_get_lineage",
      description: "Get the full fork lineage (ancestors and descendants) of a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_pin",
      description: "Pin a session so it is never auto-archived or deleted",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_unpin",
      description: "Unpin a session, restoring normal lifecycle management",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_is_session_pinned",
      description: "Check whether a session is currently pinned",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },

    // ── Feature 3: Session search ────────────────────────────────────────────
    {
      name: "sessions_search_messages",
      description: "Full-text ranked search across session message content",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          workspace_id: { type: "string" },
          session_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
    {
      name: "sessions_search_by_metadata",
      description: "Filter sessions by metadata key-value pairs (JSONB containment)",
      inputSchema: {
        type: "object",
        properties: {
          filters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                value: {},
              },
              required: ["key", "value"],
            },
          },
        },
        required: ["filters"],
      },
    },

    // ── Feature 4: Session analytics ────────────────────────────────────────
    {
      name: "sessions_get_stats",
      description: "Get aggregate usage statistics for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO timestamp lower bound (default: 30 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_list_active",
      description: "List sessions with message activity in the last hour",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },

    // ── Feature 5: Session templates ────────────────────────────────────────
    {
      name: "sessions_create_template",
      description: "Create a reusable session template with variable placeholders",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          name: { type: "string" },
          system_prompt_template: { type: "string", description: "Template with {{variable}} placeholders" },
          description: { type: "string" },
          variables: { type: "array", items: { type: "string" } },
          default_model: { type: "string" },
        },
        required: ["workspace_id", "name", "system_prompt_template"],
      },
    },
    {
      name: "sessions_render_template",
      description: "Render a session template with variable substitution",
      inputSchema: {
        type: "object",
        properties: {
          template_id: { type: "string" },
          variables: { type: "object", additionalProperties: { type: "string" }, description: "Map of variable names to values" },
        },
        required: ["template_id", "variables"],
      },
    },
    {
      name: "sessions_list_templates",
      description: "List session templates for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_get_session_template",
      description: "Get a single session template by ID",
      inputSchema: {
        type: "object",
        properties: { template_id: { type: "string" } },
        required: ["template_id"],
      },
    },
    {
      name: "sessions_get_popular_templates",
      description: "Get the most-used templates for a workspace, ranked by usage count",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_create_session_from_template",
      description: "Create a new session from a rendered template",
      inputSchema: {
        type: "object",
        properties: {
          template_id: { type: "string" },
          user_id: { type: "string" },
          variables: { type: "object", additionalProperties: { type: "string" } },
          workspace_id: { type: "string" },
          title: { type: "string" },
        },
        required: ["template_id", "user_id", "workspace_id", "variables"],
      },
    },
    {
      name: "sessions_delete_template",
      description: "Delete a session template",
      inputSchema: {
        type: "object",
        properties: { template_id: { type: "string" } },
        required: ["template_id"],
      },
    },

    // ── Feature 6: Session snapshots ──────────────────────────────────────────
    {
      name: "sessions_create_snapshot",
      description: "Create a point-in-time snapshot of a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_list_snapshots",
      description: "List snapshots for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_get_snapshot",
      description: "Get a specific snapshot by ID",
      inputSchema: {
        type: "object",
        properties: { snapshot_id: { type: "string" } },
        required: ["snapshot_id"],
      },
    },
    {
      name: "sessions_delete_snapshot",
      description: "Delete a specific snapshot by ID",
      inputSchema: {
        type: "object",
        properties: { snapshot_id: { type: "string" } },
        required: ["snapshot_id"],
      },
    },
    {
      name: "sessions_compare_snapshots",
      description: "Compare two snapshots and return a diff summary",
      inputSchema: {
        type: "object",
        properties: {
          snapshot_a: { type: "string" },
          snapshot_b: { type: "string" },
        },
        required: ["snapshot_a", "snapshot_b"],
      },
    },
    {
      name: "sessions_restore_from_snapshot",
      description: "Restore a session from a snapshot (creates auto-backup first)",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          snapshot_id: { type: "string" },
        },
        required: ["session_id", "snapshot_id"],
      },
    },

    // ── Feature 7: Session diff ─────────────────────────────────────────────
    {
      name: "sessions_diff",
      description: "Compare two sessions and return structured differences",
      inputSchema: {
        type: "object",
        properties: {
          session_a: { type: "string" },
          session_b: { type: "string" },
        },
        required: ["session_a", "session_b"],
      },
    },
    {
      name: "sessions_find_common_ancestor",
      description: "Find the common ancestor message between two forked sessions",
      inputSchema: {
        type: "object",
        properties: {
          session_a: { type: "string" },
          session_b: { type: "string" },
        },
        required: ["session_a", "session_b"],
      },
    },
    {
      name: "sessions_diff_text",
      description: "Generate a human-readable plain-text diff between two sessions",
      inputSchema: {
        type: "object",
        properties: {
          session_a: { type: "string" },
          session_b: { type: "string" },
          max_lines: { type: "number" },
        },
        required: ["session_a", "session_b"],
      },
    },

    // ── Feature 8: Session annotations ─────────────────────────────────────────
    {
      name: "sessions_create_annotation",
      description: "Create an annotation on a session or specific message(s)",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          annotation_type: { type: "string", enum: ["bookmark", "note", "highlight", "tag", "issue"] },
          label: { type: "string" },
          message_id: { type: "string" },
          start_message_id: { type: "string" },
          end_message_id: { type: "string" },
          content: { type: "object" },
          metadata: { type: "object" },
          created_by: { type: "string" },
        },
        required: ["session_id", "annotation_type", "label"],
      },
    },
    {
      name: "sessions_list_annotations",
      description: "List all annotations for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          annotation_type: { type: "string" },
          created_by: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_get_annotation",
      description: "Get a specific annotation by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "sessions_update_annotation",
      description: "Update an existing annotation's label, content, or metadata",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          content: { type: "object" },
          metadata: { type: "object" },
        },
        required: ["id"],
      },
    },
    {
      name: "sessions_delete_annotation",
      description: "Delete a specific annotation",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "sessions_delete_all_annotations",
      description: "Delete all annotations for a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_get_message_annotations",
      description: "Get all annotations for a specific message",
      inputSchema: {
        type: "object",
        properties: { message_id: { type: "string" } },
        required: ["message_id"],
      },
    },
    {
      name: "sessions_annotation_stats",
      description: "Get annotation statistics for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },

    // ── Feature 9: Retention policies ─────────────────────────────────────────
    {
      name: "sessions_upsert_retention_policy",
      description: "Create or update a retention policy for sessions",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          scope: { type: "string", enum: ["workspace", "user", "global"] },
          retention_action: { type: "string", enum: ["archive", "delete", "snapshot_then_delete"] },
          min_age_days: { type: "number" },
          max_age_days: { type: "number" },
          conditions: { type: "object" },
          enabled: { type: "boolean" },
        },
        required: ["name", "scope", "retention_action"],
      },
    },
    {
      name: "sessions_set_retention_policy_enabled",
      description: "Enable or disable a retention policy",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["id", "enabled"],
      },
    },
    {
      name: "sessions_get_retention_policy",
      description: "Get a specific retention policy by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "sessions_list_retention_policies",
      description: "List retention policies for a workspace or user",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          scope: { type: "string" },
          enabled: { type: "boolean" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "sessions_delete_retention_policy",
      description: "Delete a retention policy",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "sessions_apply_retention_policy",
      description: "Manually trigger a retention policy (dry-run or apply)",
      inputSchema: {
        type: "object",
        properties: {
          policy_id: { type: "string" },
          dry_run: { type: "boolean" },
        },
        required: ["policy_id"],
      },
    },

    // ── Feature 10: Session branching ─────────────────────────────────────────
    {
      name: "sessions_transplant_fork",
      description: "Transplant messages from one fork into another session",
      inputSchema: {
        type: "object",
        properties: {
          source_session_id: { type: "string" },
          target_session_id: { type: "string" },
          after_message_id: { type: "string", description: "Insert point in target session" },
          archive_source: { type: "boolean" },
        },
        required: ["source_session_id", "target_session_id", "after_message_id"],
      },
    },
    {
      name: "sessions_rebase_fork",
      description: "Rebase a session fork onto a new ancestor session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          new_parent_session_id: { type: "string" },
          preserve_depth: { type: "boolean" },
        },
        required: ["session_id", "new_parent_session_id"],
      },
    },
    {
      name: "sessions_get_ancestors",
      description: "Get the full ancestry chain of a session back to the root",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_find_merge_base",
      description: "Find the common ancestor between two sessions",
      inputSchema: {
        type: "object",
        properties: {
          session_a: { type: "string" },
          session_b: { type: "string" },
        },
        required: ["session_a", "session_b"],
      },
    },
    // --- Session tags ---
    {
      name: "sessions_tag_session",
      description: "Add one or more tags to a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          created_by: { type: "string" },
        },
        required: ["session_id", "tags"],
      },
    },
    {
      name: "sessions_untag_session",
      description: "Remove a tag from a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          tag: { type: "string" },
        },
        required: ["session_id", "tag"],
      },
    },
    {
      name: "sessions_list_tags",
      description: "List all tags for a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_find_by_tag",
      description: "Find sessions with a given tag in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          tag: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id", "tag"],
      },
    },
    {
      name: "sessions_workspace_tags",
      description: "List all tags used in a workspace with usage counts",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    // --- Session bookmarks ---
    {
      name: "sessions_bookmark_message",
      description: "Bookmark a message within a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          message_id: { type: "string" },
          label: { type: "string" },
          note: { type: "string" },
          created_by: { type: "string" },
        },
        required: ["session_id", "message_id"],
      },
    },
    {
      name: "sessions_remove_bookmark",
      description: "Remove a bookmark from a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          message_id: { type: "string" },
        },
        required: ["session_id", "message_id"],
      },
    },
    {
      name: "sessions_list_bookmarks",
      description: "List all bookmarks in a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_is_message_bookmarked",
      description: "Check whether a specific message is bookmarked in a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          message_id: { type: "string" },
        },
        required: ["session_id", "message_id"],
      },
    },
    {
      name: "sessions_bookmark_count",
      description: "Count bookmarks in a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    // --- Session metrics ---
    {
      name: "sessions_record_tokens",
      description: "Record token usage for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          prompt_tokens: { type: "number" },
          completion_tokens: { type: "number" },
          cost_per_thousand_cents: { type: "number" },
        },
        required: ["session_id", "prompt_tokens", "completion_tokens"],
      },
    },
    {
      name: "sessions_record_response_time",
      description: "Record assistant response time for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          response_time_ms: { type: "number" },
        },
        required: ["session_id", "response_time_ms"],
      },
    },
    {
      name: "sessions_get_metrics",
      description: "Get usage metrics for a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_top_token_sessions",
      description: "Get the most token-heavy sessions in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_workspace_usage",
      description: "Get aggregate usage totals for a workspace",
      inputSchema: {
        type: "object",
        properties: { workspace_id: { type: "string" } },
        required: ["workspace_id"],
      },
    },
    // Session importance scoring
    {
      name: "sessions_compute_importance",
      description: "Compute and store the importance score for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          message_count: { type: "number" },
          last_activity_hours: { type: "number" },
          annotation_count: { type: "number" },
          bookmark_count: { type: "number" },
          fork_count: { type: "number" },
          is_pinned: { type: "boolean" },
          is_archived: { type: "boolean" },
          is_fork_pinned: { type: "boolean" },
          has_root_session: { type: "boolean" },
          token_count: { type: "number" },
          days_old: { type: "number" },
          is_pinned_override: { type: "boolean" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_get_importance",
      description: "Get the importance score for a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_list_by_importance",
      description: "List sessions sorted by importance score (highest first)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          min_score: { type: "number" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_list_at_risk",
      description: "List sessions at risk of auto-archival (low importance, old, no pins/forks)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          max_score: { type: "number" },
          min_age_days: { type: "number" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_recompute_all_importance",
      description: "Batch-recompute importance scores for all sessions in a workspace — returns count of sessions processed",
      inputSchema: {
        type: "object",
        properties: { workspace_id: { type: "string" } },
        required: ["workspace_id"],
      },
    },
    // Fork lifecycle
    {
      name: "sessions_init_fork_lifecycle",
      description: "Initialize lifecycle tracking for a new fork",
      inputSchema: {
        type: "object",
        properties: {
          fork_id: { type: "string" },
          parent_session_id: { type: "string" },
        },
        required: ["fork_id"],
      },
    },
    {
      name: "sessions_get_fork_lifecycle",
      description: "Get the lifecycle state of a fork",
      inputSchema: {
        type: "object",
        properties: { fork_id: { type: "string" } },
        required: ["fork_id"],
      },
    },
    {
      name: "sessions_archive_fork",
      description: "Archive a fork",
      inputSchema: {
        type: "object",
        properties: {
          fork_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["fork_id"],
      },
    },
    {
      name: "sessions_delete_fork",
      description: "Permanently delete a fork",
      inputSchema: {
        type: "object",
        properties: { fork_id: { type: "string" } },
        required: ["fork_id"],
      },
    },
    {
      name: "sessions_promote_fork",
      description: "Promote a fork to be a standalone session",
      inputSchema: {
        type: "object",
        properties: {
          fork_id: { type: "string" },
          new_session_id: { type: "string" },
        },
        required: ["fork_id", "new_session_id"],
      },
    },
    {
      name: "sessions_list_forks_by_state",
      description: "List forks filtered by lifecycle state",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          state: { type: "string", enum: ["active", "archived", "orphaned", "promoted", "deleted"] },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id", "state"],
      },
    },
    {
      name: "sessions_get_fork_stats",
      description: "Get fork statistics for a workspace by lifecycle state",
      inputSchema: {
        type: "object",
        properties: { workspace_id: { type: "string" } },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_record_fork_access",
      description: "Record that a fork was accessed — updates last_accessed_at timestamp",
      inputSchema: {
        type: "object",
        properties: { fork_id: { type: "string" } },
        required: ["fork_id"],
      },
    },
    {
      name: "sessions_pin_fork",
      description: "Pin a fork so it is protected from automatic archival or cleanup",
      inputSchema: {
        type: "object",
        properties: {
          fork_id: { type: "string" },
          pinned_by: { type: "string" },
          pin_note: { type: "string" },
          auto_protect: { type: "boolean" },
        },
        required: ["fork_id"],
      },
    },
    {
      name: "sessions_unpin_fork",
      description: "Remove the pin from a fork, restoring normal lifecycle policies",
      inputSchema: {
        type: "object",
        properties: {
          fork_id: { type: "string" },
          pin_note: { type: "string" },
        },
        required: ["fork_id"],
      },
    },
    {
      name: "sessions_list_pinned_forks",
      description: "List all pinned forks for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_get_fork_pin",
      description: "Get the pin record for a specific fork",
      inputSchema: {
        type: "object",
        properties: { fork_id: { type: "string" } },
        required: ["fork_id"],
      },
    },
    {
      name: "sessions_list_pinned_forks_by_user",
      description: "List all forks pinned by a specific user in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id", "user_id"],
      },
    },
    {
      name: "sessions_bulk_pin_forks",
      description: "Pin multiple forks at once for protection from auto-archive",
      inputSchema: {
        type: "object",
        properties: {
          fork_ids: { type: "array", items: { type: "string" } },
          pinned_by: { type: "string" },
          pin_note: { type: "string" },
          auto_protect: { type: "boolean" },
        },
        required: ["fork_ids"],
      },
    },
    {
      name: "sessions_count_pinned_forks",
      description: "Count total pinned forks in a workspace",
      inputSchema: {
        type: "object",
        properties: { workspace_id: { type: "string" } },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_is_fork_pinned",
      description: "Check whether a fork is currently pinned",
      inputSchema: {
        type: "object",
        properties: { fork_id: { type: "string" } },
        required: ["fork_id"],
      },
    },
    {
      name: "sessions_get_pin_details",
      description: "Get detailed pin information for a fork including auto_protect status and pin note",
      inputSchema: {
        type: "object",
        properties: { fork_id: { type: "string" } },
        required: ["fork_id"],
      },
    },
    // Summary settings
    {
      name: "sessions_get_summary_settings",
      description: "Get the summary configuration for a workspace",
      inputSchema: {
        type: "object",
        properties: { workspace_id: { type: "string" } },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_update_summary_settings",
      description: "Update summary configuration for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          default_keep_recent: { type: "number" },
          default_target_tokens: { type: "number" },
          auto_summarize_threshold: { type: "number" },
          summarize_model: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_should_auto_summarize",
      description: "Check whether auto-summarization should trigger for a workspace given the current token count. Returns whether summarization is recommended, the configured threshold, and whether auto-summarization is enabled.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          current_token_count: { type: "number", description: "Current token count in the session" },
        },
        required: ["workspace_id", "current_token_count"],
      },
    },
    // Scheduled archival
    {
      name: "sessions_schedule_archival",
      description: "Schedule an archival task for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          scheduled_for: { type: "string" },
          action: { type: "string", enum: ["archive", "delete", "snapshot_then_delete", "summarize"] },
          retention_policy_id: { type: "string" },
        },
        required: ["session_id", "scheduled_for", "action"],
      },
    },
    {
      name: "sessions_cancel_archival",
      description: "Cancel a scheduled archival",
      inputSchema: {
        type: "object",
        properties: { archival_id: { type: "string" } },
        required: ["archival_id"],
      },
    },
    {
      name: "sessions_list_due_archivals",
      description: "List pending archivals that are due for processing",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
    },
    {
      name: "sessions_get_scheduled_archival",
      description: "Get a specific scheduled archival by ID",
      inputSchema: {
        type: "object",
        properties: { archival_id: { type: "string" } },
        required: ["archival_id"],
      },
    },
    {
      name: "sessions_list_pending_archivals",
      description: "List all pending archivals for a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_get_archival_stats",
      description: "Get archival statistics by status for a workspace",
      inputSchema: {
        type: "object",
        properties: { workspace_id: { type: "string" } },
      },
    },
    // Retention policy rules (advanced)
    {
      name: "sessions_create_retention_policy_rule",
      description: "Create an advanced retention policy rule with age/importance/access triggers",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          name: { type: "string" },
          trigger: { type: "string", enum: ["age", "importance_floor", "access_count", "manual"] },
          action: { type: "string", enum: ["archive", "soft_delete", "hard_delete", "summarize"] },
          age_threshold_days: { type: "number" },
          importance_floor: { type: "number" },
          access_count_floor: { type: "number" },
          access_lookback_days: { type: "number" },
          apply_to_forks: { type: "boolean" },
          apply_to_root: { type: "boolean" },
          retain_pinned: { type: "boolean" },
          dry_run: { type: "boolean" },
          enabled: { type: "boolean" },
        },
        required: ["workspace_id", "name", "trigger", "action"],
      },
    },
    {
      name: "sessions_list_retention_policy_rules",
      description: "List advanced retention policy rules for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          trigger: { type: "string" },
          action: { type: "string" },
          enabled: { type: "boolean" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
      },
    },
    {
      name: "sessions_execute_retention_policy_rule",
      description: "Execute an advanced retention policy rule (dry-run or apply)",
      inputSchema: {
        type: "object",
        properties: {
          policy_id: { type: "string" },
          dry_run: { type: "boolean" },
        },
        required: ["policy_id"],
      },
    },
    {
      name: "sessions_execute_all_retention_rules",
      description: "Execute all enabled retention policy rules for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          dry_run: { type: "boolean" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_get_retention_history",
      description: "Get retention policy execution history for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          policy_id: { type: "string" },
          action: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
      },
    },
    // Bulk scheduled archival — schedule the same action across many sessions at once
    {
      name: "sessions_bulk_schedule_archival",
      description: "Schedule the same archival action (archive/delete/snapshot_then_delete/summarize) for multiple sessions in a single call",
      inputSchema: {
        type: "object",
        properties: {
          session_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200, description: "Session IDs to schedule (max 200)" },
          scheduled_for: { type: "string", description: "ISO timestamp for when to run the archival" },
          action: { type: "string", enum: ["archive", "delete", "snapshot_then_delete", "summarize"] },
          retention_policy_id: { type: "string" },
        },
        required: ["session_ids", "scheduled_for", "action"],
      },
    },
    // List scheduled archivals for an entire workspace (not just per-session)
    {
      name: "sessions_list_workspace_scheduled_archivals",
      description: "List all scheduled archivals for a workspace with optional status and action filters",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "cancelled"] },
          action: { type: "string", enum: ["archive", "delete", "snapshot_then_delete", "summarize"] },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    // Get retention policy rules (full detail) for a workspace
    {
      name: "sessions_get_retention_policy_rules",
      description: "Get the full retention policy rules for a workspace including all triggers, thresholds, and settings",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          enabled: { type: "boolean" },
          trigger: { type: "string", enum: ["age", "importance_floor", "access_count", "manual"] },
          action: { type: "string", enum: ["archive", "soft_delete", "hard_delete", "summarize"] },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    // Context — estimate tokens
    {
      name: "sessions_estimate_tokens",
      description: "Estimate token count for a text string",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to estimate tokens for" },
          model: { type: "string", description: "Model to use for estimation" },
        },
        required: ["text"],
      },
    },
    // Conversation — update conversation metadata
    {
      name: "sessions_update_conversation",
      description: "Update conversation title, model, system prompt, or metadata",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          title: { type: "string" },
          model: { type: "string" },
          system_prompt: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["conversation_id"],
      },
    },
    // Conversation — update summary
    {
      name: "sessions_update_summary",
      description: "Update the auto-generated summary of a conversation",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          summary: { type: "string" },
          summary_model: { type: "string" },
        },
        required: ["conversation_id", "summary"],
      },
    },
    // Messages — get a single message
    {
      name: "sessions_get_message",
      description: "Get a single message by ID",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string" },
        },
        required: ["message_id"],
      },
    },
    // Messages — delete a message
    {
      name: "sessions_delete_message",
      description: "Delete a message by ID",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string" },
        },
        required: ["message_id"],
      },
    },
    // Session summaries — list summaries
    {
      name: "sessions_list_summaries",
      description: "List stored conversation summaries for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          conversation_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    // Tags — bulk tag sessions
    {
      name: "sessions_bulk_tag",
      description: "Add a tag to multiple sessions at once",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          session_ids: { type: "array", items: { type: "string" } },
          tag: { type: "string" },
        },
        required: ["workspace_id", "session_ids", "tag"],
      },
    },
    // Tags — update tag color
    {
      name: "sessions_update_tag_color",
      description: "Update the color of a workspace tag",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          tag: { type: "string" },
          color: { type: "string" },
        },
        required: ["workspace_id", "tag", "color"],
      },
    },
    // Tags — find orphan tags
    {
      name: "sessions_find_orphan_tags",
      description: "Find tags with no sessions attached in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    // Bookmarks — clear all bookmarks for a session
    {
      name: "sessions_clear_bookmarks",
      description: "Clear all bookmarks for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
        },
        required: ["session_id"],
      },
    },
    // Metrics — delete metrics for a session
    {
      name: "sessions_delete_metrics",
      description: "Delete all metrics stored for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
        },
        required: ["session_id"],
      },
    },
    // Snapshots — prune old snapshots
    {
      name: "sessions_prune_snapshots",
      description: "Delete snapshots older than a given age for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          older_than_days: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    // Templates — update a template
    {
      name: "sessions_update_template",
      description: "Update a session template (name, description, variables, body)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          body: { type: "string" },
          variables: { type: "array", items: { type: "object" } },
          is_active: { type: "boolean" },
        },
        required: ["id"],
      },
    },
    // Summary settings — delete settings
    {
      name: "sessions_delete_summary_settings",
      description: "Delete summary settings for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    // Retention — get retention stats
    {
      name: "sessions_get_retention_stats",
      description: "Get retention statistics for a workspace (counts by policy)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    // Scheduler — start archival
    {
      name: "sessions_start_archival",
      description: "Start the archival process for a scheduled archival entry",
      inputSchema: {
        type: "object",
        properties: {
          archival_id: { type: "string" },
        },
        required: ["archival_id"],
      },
    },
    // Scheduler — complete archival
    {
      name: "sessions_complete_archival",
      description: "Mark an archival as completed",
      inputSchema: {
        type: "object",
        properties: {
          archival_id: { type: "string" },
        },
        required: ["archival_id"],
      },
    },
    // Scheduler — fail archival
    {
      name: "sessions_fail_archival",
      description: "Mark an archival as failed with an error",
      inputSchema: {
        type: "object",
        properties: {
          archival_id: { type: "string" },
          error: { type: "string" },
        },
        required: ["archival_id", "error"],
      },
    },
    // Scheduler — schedule archivals for a policy
    {
      name: "sessions_schedule_archivals_for_policy",
      description: "Create scheduled archival entries for all sessions matching a policy",
      inputSchema: {
        type: "object",
        properties: {
          policy_id: { type: "string" },
        },
        required: ["policy_id"],
      },
    },
    // Fork lifecycle — orphan child forks when parent deleted
    {
      name: "sessions_orphan_forks",
      description: "Mark child forks as orphaned when their parent session is deleted",
      inputSchema: {
        type: "object",
        properties: {
          parent_session_id: { type: "string" },
        },
        required: ["parent_session_id"],
      },
    },
    // Fork lifecycle — list stale orphaned forks
    {
      name: "sessions_list_stale_forks",
      description: "List orphaned forks that haven't been accessed recently",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          stale_days: { type: "number", default: 30 },
        },
        required: ["workspace_id"],
      },
    },
    // Fork lifecycle — transition fork state
    {
      name: "sessions_transition_fork",
      description: "Transition a fork to a new lifecycle state",
      inputSchema: {
        type: "object",
        properties: {
          fork_id: { type: "string" },
          new_state: {
            type: "string",
            enum: ["active", "archived", "orphaned", "promoted", "deleted"],
          },
          preservation_reason: { type: "string" },
          promoted_to_session_id: { type: "string" },
        },
        required: ["fork_id", "new_state"],
      },
    },
    // Snapshots — create a point-in-time snapshot of a session
    {
      name: "sessions_snapshot_session",
      description: "Create a point-in-time snapshot of a session capturing all messages and metadata",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          label: { type: "string", description: "Optional label for the snapshot" },
          description: { type: "string", description: "Optional description for the snapshot" },
        },
        required: ["session_id"],
      },
    },
    // Snapshots — get snapshot data without restoring
    {
      name: "sessions_get_snapshot_data",
      description: "Get the full snapshot data (conversation, messages, stats) without restoring",
      inputSchema: {
        type: "object",
        properties: { snapshot_id: { type: "string" } },
        required: ["snapshot_id"],
      },
    },
    // Templates — render a template with variable substitution
    {
      name: "sessions_render_template",
      description: "Render a session template with variable substitution (uses {{variable}} syntax)",
      inputSchema: {
        type: "object",
        properties: {
          template_id: { type: "string" },
          variables: { type: "object", description: "Key-value pairs for variable substitution" },
        },
        required: ["template_id", "variables"],
      },
    },
    // Templates — get most-used templates for a workspace
    {
      name: "sessions_get_popular_templates",
      description: "Get the most frequently used session templates for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number", description: "Max templates to return (default 5)" },
        },
        required: ["workspace_id"],
      },
    },

    // ─── Session Sharing ──────────────────────────────────────────────────────────
    {
      name: "sessions_share_session",
      description: "Share a session with a user or team with a specific role",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          share_type: { type: "string", enum: ["user", "team"] },
          principal_id: { type: "string" },
          role: { type: "string", enum: ["viewer", "commenter", "editor", "admin"] },
          shared_by: { type: "string" },
          expires_at: { type: "string", description: "ISO timestamp when share expires (optional)" },
          note: { type: "string", description: "Optional note about this share" },
        },
        required: ["session_id", "share_type", "principal_id", "role", "shared_by"],
      },
    },
    {
      name: "sessions_revoke_share",
      description: "Revoke a session share",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          share_type: { type: "string", enum: ["user", "team"] },
          principal_id: { type: "string" },
        },
        required: ["session_id", "share_type", "principal_id"],
      },
    },
    {
      name: "sessions_list_shares",
      description: "List all shares for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_list_shared_with_me",
      description: "List all sessions shared with the current user",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["user_id"],
      },
    },
    {
      name: "sessions_check_access",
      description: "Check if a principal has a given role on a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          principal_id: { type: "string" },
          principal_type: { type: "string", enum: ["user", "team"] },
          min_role: { type: "string", enum: ["viewer", "commenter", "editor", "admin"] },
        },
        required: ["session_id", "principal_id", "principal_type", "min_role"],
      },
    },
    {
      name: "sessions_bulk_share",
      description: "Bulk share a session with multiple users or teams",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          shares: {
            type: "array",
            items: {
              type: "object",
              properties: {
                share_type: { type: "string", enum: ["user", "team"] },
                principal_id: { type: "string" },
                role: { type: "string", enum: ["viewer", "commenter", "editor", "admin"] },
              },
              required: ["share_type", "principal_id", "role"],
            },
          },
          shared_by: { type: "string" },
        },
        required: ["session_id", "shares", "shared_by"],
      },
    },

    // ─── Content Filtering ────────────────────────────────────────────────────────
    {
      name: "sessions_redact_content",
      description: "Redact PII/sensitive content from text (email, phone, SSN, credit card, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          patterns: {
            type: "array",
            items: { type: "string", enum: ["email", "phone", "ssn", "credit_card", "ip_address", "api_key", "password", "jwt"] },
            description: "Which patterns to redact (defaults to all common patterns)",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "sessions_detect_sensitive",
      description: "Detect and report sensitive content without redacting",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
    },
    {
      name: "sessions_redact_messages",
      description: "Redact PII from a batch of messages",
      inputSchema: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
              },
              required: ["content"],
            },
          },
          patterns: {
            type: "array",
            items: { type: "string", enum: ["email", "phone", "ssn", "credit_card", "ip_address", "api_key", "password", "jwt"] },
          },
        },
        required: ["messages"],
      },
    },

    // ─── Session Merge ────────────────────────────────────────────────────────────
    {
      name: "sessions_three_way_merge",
      description: "Perform a 3-way merge combining changes from two sessions into a new session",
      inputSchema: {
        type: "object",
        properties: {
          source_session_id: { type: "string" },
          target_session_id: { type: "string" },
          ancestor_session_id: { type: "string" },
          new_session_title: { type: "string" },
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          conflict_strategy: { type: "string", enum: ["source_wins", "target_wins", "keep_both", "skip"] },
          archive_source: { type: "boolean" },
          archive_target: { type: "boolean" },
        },
        required: ["source_session_id", "target_session_id", "ancestor_session_id"],
      },
    },

    // ─── Summary Search ──────────────────────────────────────────────────────────
    {
      name: "sessions_search_summaries",
      description: "Full-text search across stored session summaries — helps discover sessions by what was summarized about them",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          query: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id", "query"],
      },
    },

    // ─── Bulk Pin ────────────────────────────────────────────────────────────────
    {
      name: "sessions_bulk_pin",
      description: "Pin multiple sessions at once so they are protected from auto-archival or deletion",
      inputSchema: {
        type: "object",
        properties: {
          session_ids: { type: "array", items: { type: "string" } },
        },
        required: ["session_ids"],
      },
    },

    // ─── Recent Sessions ─────────────────────────────────────────────────────────
    {
      name: "sessions_list_recent",
      description: "List the most recently active sessions in a workspace, ordered by last message time",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_get_conversation_stats",
      description: "Get aggregate statistics for all conversations in a workspace — message counts, token totals, fork counts, and activity metrics",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          since: { type: "string", description: "ISO date to filter from" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_search_shared",
      description: "Search sessions shared with a specific user or team — finds sessions where the user has viewer/commenter/editor access",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          query: { type: "string" },
          role: { type: "string", enum: ["viewer", "commenter", "editor", "admin"] },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id", "user_id"],
      },
    },
    {
      name: "sessions_get_activity_overview",
      description: "Get an activity overview for a workspace — messages per day, active sessions, top users by volume, for a given time window",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          days: { type: "number", description: "Number of days to look back (default: 30)" },
          user_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_link_external",
      description: "Link a session to an external service ID (e.g., a traces trace_id, knowledge document_id). Enables cross-service correlation for unified debugging.",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Session/conversation ID" },
          external_service: { type: "string", description: "External service name (e.g., traces, knowledge, memory)" },
          external_id: { type: "string", description: "External ID to link (e.g., trace_id, document_id)" },
          link_type: { type: "string", description: "Link type (e.g., related, caused_by, parent). Default: related" },
          metadata: { type: "object", description: "Additional metadata for the link" },
        },
        required: ["conversation_id", "external_service", "external_id"],
      },
    },
    {
      name: "sessions_get_links",
      description: "Get all external links for a session",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Session/conversation ID" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_get_by_external_id",
      description: "Find sessions linked to a specific external ID (e.g., find all sessions related to a trace)",
      inputSchema: {
        type: "object",
        properties: {
          external_service: { type: "string", description: "External service name" },
          external_id: { type: "string", description: "External ID" },
        },
        required: ["external_service", "external_id"],
      },
    },
    {
      name: "sessions_delete_link",
      description: "Delete a session link by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Link ID to delete" },
        },
        required: ["id"],
      },
    },
    {
      name: "sessions_delete_all_links",
      description: "Delete all external links for a session",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Session/conversation ID" },
        },
        required: ["conversation_id"],
      },
    },
    // Session replay export
    {
      name: "sessions_export_replay",
      description: "Export a session in replayable JSON format with full context (messages, metadata, lineage, annotations) for debugging or replay",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Session/conversation ID" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_export_diff",
      description: "Export the diff between two sessions showing what messages are new or changed",
      inputSchema: {
        type: "object",
        properties: {
          base_session_id: { type: "string", description: "Base session ID to compare from" },
          compare_session_id: { type: "string", description: "Session ID to compare to" },
        },
        required: ["base_session_id", "compare_session_id"],
      },
    },
    {
      name: "sessions_export_archive",
      description: "Export multiple sessions in a batch archive format",
      inputSchema: {
        type: "object",
        properties: {
          conversation_ids: { type: "array", items: { type: "string" }, description: "Array of session IDs to include in archive" },
        },
        required: ["conversation_ids"],
      },
    },

    // ─── Auto summarization ────────────────────────────────────────────────────
    {
      name: "sessions_get_sessions_needing_summarization",
      description: "Find sessions approaching their context window limit that would benefit from auto-summarization",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          min_tokens: { type: "number", description: "Minimum token count to include (default 3000)" },
          limit: { type: "number", description: "Max sessions to return (default 20)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_process_auto_summarization",
      description: "Run auto-summarization on sessions that need it, up to a batch limit",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          batch_limit: { type: "number", description: "Max sessions to summarize in this run (default 10)" },
          min_tokens: { type: "number", description: "Minimum token threshold (default 3000)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_get_context_window_fill",
      description: "Get the current token fill percentage for a session's context window",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          max_tokens: { type: "number", description: "Override max tokens for model (default auto-detect)" },
        },
        required: ["session_id"],
      },
    },

    // ─── Branch comparison ──────────────────────────────────────────────────────
    {
      name: "sessions_compare_branches",
      description: "Compare two session branches (forks) to understand their divergence — shows unique messages, shared ancestor, and diff summary",
      inputSchema: {
        type: "object",
        properties: {
          session_a_id: { type: "string", description: "First branch session ID" },
          session_b_id: { type: "string", description: "Second branch session ID" },
          include_messages: { type: "boolean", description: "Include full message lists (default false)" },
        },
        required: ["session_a_id", "session_b_id"],
      },
    },
    {
      name: "sessions_list_branch_pairs",
      description: "List all fork branch pairs from a root session — useful for visualizing fork trees and comparing all branches at once",
      inputSchema: {
        type: "object",
        properties: {
          root_session_id: { type: "string" },
          min_divergence_messages: { type: "number", description: "Minimum messages in common to count as diverged (default 3)" },
        },
        required: ["root_session_id"],
      },
    },
    {
      name: "sessions_create_retention_policy",
      description: "Create a retention policy for a workspace — defines rules to auto-archive, soft-delete, hard-delete, or summarize sessions based on age, importance floor, or access count",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          name: { type: "string" },
          trigger: { type: "string", enum: ["age", "importance_floor", "access_count", "manual"] },
          action: { type: "string", enum: ["archive", "soft_delete", "hard_delete", "summarize"] },
          age_threshold_days: { type: "number" },
          importance_floor: { type: "number" },
          access_count_floor: { type: "number" },
          access_lookback_days: { type: "number" },
          apply_to_forks: { type: "boolean" },
          apply_to_root: { type: "boolean" },
          retain_pinned: { type: "boolean" },
          dry_run: { type: "boolean" },
        },
        required: ["workspace_id", "name", "trigger", "action"],
      },
    },
    {
      name: "sessions_execute_retention_policy",
      description: "Execute a single retention policy — evaluates all sessions matching the policy criteria and applies the configured action",
      inputSchema: {
        type: "object",
        properties: {
          policy_id: { type: "string" },
        },
        required: ["policy_id"],
      },
    },
    {
      name: "sessions_execute_all_retention_policies",
      description: "Execute all enabled retention policies for a workspace — batch-process all policies in sequence",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          dry_run: { type: "boolean" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_reschedule_archival",
      description: "Reschedule a pending archival to a new time",
      inputSchema: {
        type: "object",
        properties: {
          archival_id: { type: "string" },
          new_scheduled_for: { type: "string", description: "ISO 8601 datetime" },
        },
        required: ["archival_id", "new_scheduled_for"],
      },
    },
    {
      name: "sessions_cancel_scheduled_archival",
      description: "Cancel a pending scheduled archival",
      inputSchema: {
        type: "object",
        properties: {
          archival_id: { type: "string" },
        },
        required: ["archival_id"],
      },
    },
    {
      name: "sessions_list_pending_archivals_for_session",
      description: "List all pending scheduled archivals for a specific session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
        },
        required: ["session_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as any;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });
  if (name === "sessions_create_conversation") {
    return text(
      await createConversation(sql, {
        workspace_id: String(a.workspace_id),
        user_id: String(a.user_id),
        title: a.title ? String(a.title) : undefined,
        model: a.model ? String(a.model) : undefined,
        system_prompt: a.system_prompt ? String(a.system_prompt) : undefined,
        metadata: a.metadata as any | undefined,
      }),
    );
  }

  if (name === "sessions_list_conversations") {
    return text(
      await listConversations(sql, String(a.workspace_id), String(a.user_id), {
        archived: a.archived as boolean | undefined,
        search: a.search ? String(a.search) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
        offset: a.offset ? Number(a.offset) : undefined,
      }),
    );
  }

  if (name === "sessions_list_active_sessions") {
    return text(
      await listActiveSessions(sql, String(a.workspace_id), a.limit ? Number(a.limit) : 20),
    );
  }

  if (name === "sessions_pivot_sessions") {
    const dims = (a.dimensions as Array<{ field: string; label: string }>).map(d => ({
      field: d.field as any,
      label: d.label,
    }));
    return text(
      await pivotSessions(sql, String(a.workspace_id), dims, {
        since: a.since ? String(a.since) : undefined,
        until: a.until ? String(a.until) : undefined,
        groupLimit: a.group_limit ? Number(a.group_limit) : undefined,
      }),
    );
  }

  if (name === "sessions_cross_tab_sessions") {
    return text(
      await crossTabSessions(
        sql,
        String(a.workspace_id),
        a.row_dim as any,
        a.col_dim as any,
        (a.measure || "messages") as any,
        {
          since: a.since ? String(a.since) : undefined,
          until: a.until ? String(a.until) : undefined,
        },
      ),
    );
  }

  if (name === "sessions_get_duration_insights") {
    return text(
      await getDurationInsights(sql, String(a.workspace_id), a.since ? String(a.since) : undefined),
    );
  }

  if (name === "sessions_get_duration_buckets") {
    return text(
      await getDurationBuckets(
        sql,
        String(a.workspace_id),
        a.buckets ? (a.buckets as number[]).map(Number) : undefined,
        a.since ? String(a.since) : undefined,
      ),
    );
  }

  if (name === "sessions_calculate_session_quality") {
    const score = await calculateSessionQuality(sql, String(a.session_id));
    if (score) {
      await storeSessionQualityScore(sql, String(a.session_id), score);
    }
    return text({ quality_score: score });
  }

  if (name === "sessions_check_session_health") {
    return text(await checkSessionHealth(sql, String(a.session_id)));
  }

  if (name === "sessions_list_by_quality") {
    return text(
      await listSessionsByQuality(
        sql,
        String(a.workspace_id),
        a.tier ? String(a.tier) as any : undefined,
        a.limit ? Number(a.limit) : 50,
      ),
    );
  }

  if (name === "sessions_get_conversation") {
    return text(await getConversation(sql, String(a.id)));
  }

  if (name === "sessions_add_message") {
    return text(
      await addMessage(sql, String(a.conversation_id), {
        role: String(a.role) as "system" | "user" | "assistant" | "tool",
        content: String(a.content),
        name: a.name ? String(a.name) : undefined,
        tool_calls: a.tool_calls,
        tokens: a.tokens ? Number(a.tokens) : undefined,
        latency_ms: a.latency_ms ? Number(a.latency_ms) : undefined,
        model: a.model ? String(a.model) : undefined,
        metadata: a.metadata as any | undefined,
      }),
    );
  }

  if (name === "sessions_get_messages") {
    return text(
      await getMessages(sql, String(a.conversation_id), {
        limit: a.limit ? Number(a.limit) : undefined,
        before: a.before ? String(a.before) : undefined,
        after: a.after ? String(a.after) : undefined,
        role: a.role ? String(a.role) : undefined,
      }),
    );
  }

  if (name === "sessions_get_context_window") {
    return text(
      await getContextWindow(
        sql,
        String(a.conversation_id),
        Number(a.max_tokens),
      ),
    );
  }

  if (name === "sessions_search_messages") {
    return text(
      await searchMessages(sql, String(a.workspace_id), String(a.query), {
        conversationId: a.conversation_id
          ? String(a.conversation_id)
          : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
      }),
    );
  }

  if (name === "sessions_delete_conversation") {
    return text({ deleted: await deleteConversation(sql, String(a.id)) });
  }

  if (name === "sessions_archive_conversation") {
    return text(await archiveConversation(sql, String(a.id)));
  }

  if (name === "sessions_fork_conversation") {
    return text(
      await forkConversation(
        sql,
        String(a.conversation_id),
        String(a.from_message_id),
        { title: a.title ? String(a.title) : undefined, pinFork: a.pin_fork as boolean | undefined },
      ),
    );
  }

  if (name === "sessions_get_fork_tree") {
    const { getForkTree } = await import("../lib/conversations.js");
    return text(await getForkTree(sql, String(a.conversation_id)));
  }

  if (name === "sessions_get_root_conversation") {
    const { getRootConversation } = await import("../lib/conversations.js");
    return text(await getRootConversation(sql, String(a.conversation_id)));
  }

  if (name === "sessions_list_child_forks") {
    const { listChildForks } = await import("../lib/conversations.js");
    return text(await listChildForks(sql, String(a.conversation_id)));
  }

  if (name === "sessions_set_fork_pinned") {
    const { setForkPinned } = await import("../lib/conversations.js");
    return text(await setForkPinned(sql, String(a.id), Boolean(a.pinned)));
  }

  if (name === "sessions_store_context_summary") {
    const { storeContextSummary } = await import("../lib/context-summary.js");
    return text(await storeContextSummary(sql, String(a.conversation_id), String(a.summary_text), Number(a.tokens_used), { keepRecent: a.keep_recent ? Number(a.keep_recent) : undefined }));
  }

  if (name === "sessions_build_summary_input") {
    const { buildSummaryInput } = await import("../lib/context-summary.js");
    const { getMessages } = await import("../lib/messages.js");
    const msgs = await getMessages(sql, String(a.conversation_id), { limit: 9999 });
    return text(buildSummaryInput(msgs, a.keep_recent ? Number(a.keep_recent) : 5));
  }

  if (name === "sessions_get_summarization_history") {
    const { getSummarizationHistory } = await import("../lib/context-summary.js");
    return text(await getSummarizationHistory(sql, String(a.conversation_id)));
  }

  if (name === "sessions_estimate_summarization_savings") {
    const { estimateSummarizationSavings } = await import("../lib/context-summary.js");
    return text(await estimateSummarizationSavings(sql, String(a.conversation_id), a.keep_recent ? Number(a.keep_recent) : 5));
  }

  if (name === "sessions_needs_summarization") {
    const { needsSummarization } = await import("../lib/context-summary.js");
    return text(await needsSummarization(sql, String(a.conversation_id), a.threshold ? Number(a.threshold) : 6000));
  }

  if (name === "sessions_mark_prior_as_summarized") {
    const { markPriorAsSummarized } = await import("../lib/context-summary.js");
    return text({ marked: await markPriorAsSummarized(sql, String(a.conversation_id), a.count ? Number(a.count) : 1) });
  }

  if (name === "sessions_export_conversation") {
    const format = (a.format ? String(a.format) : "markdown") as
      | "markdown"
      | "json";
    return text(
      await exportConversation(sql, String(a.conversation_id), format),
    );
  }

  if (name === "sessions_pin_message") {
    return text(await pinMessage(sql, String(a.id)));
  }

  // ── Feature 1: Session summarization ──────────────────────────────────────
  if (name === "sessions_summarize_session") {
    const result = await summarizeSession(
      sql,
      String(a.session_id),
      a.max_length ? Number(a.max_length) : 2000,
    );
    // Store the generated summary
    await storeSessionSummary(sql, String(a.session_id), result.summary);
    return text(result);
  }

  if (name === "sessions_get_session_summary") {
    return text(await getSessionSummary(sql, String(a.session_id)));
  }

  // ── Feature 2: Session fork / pin ────────────────────────────────────────
  if (name === "sessions_fork_session") {
    return text(
      await forkSession(
        sql,
        String(a.session_id),
        a.new_namespace ? String(a.new_namespace) : undefined,
      ),
    );
  }

  if (name === "sessions_get_lineage") {
    return text(await getSessionLineage(sql, String(a.session_id)));
  }

  if (name === "sessions_pin") {
    return text(await pinSession(sql, String(a.session_id)));
  }

  if (name === "sessions_unpin") {
    return text(await unpinSession(sql, String(a.session_id)));
  }

  if (name === "sessions_is_session_pinned") {
    return text({ pinned: await isSessionPinned(sql, String(a.session_id)) });
  }

  // ── Feature 3: Session search ────────────────────────────────────────────
  if (name === "sessions_search_messages") {
    return text(
      await searchSessionsMessages(sql, String(a.query), {
        workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
        sessionId: a.session_id ? String(a.session_id) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
      }),
    );
  }

  if (name === "sessions_search_by_metadata") {
    return text(
      await searchSessionsByMetadata(sql, (a.filters ?? []) as any),
    );
  }

  // ── Feature 4: Session analytics ──────────────────────────────────────────
  if (name === "sessions_get_stats") {
    return text(
      await getSessionStats(
        sql,
        String(a.workspace_id),
        a.since ? String(a.since) : undefined,
      ),
    );
  }

  if (name === "sessions_list_active") {
    return text(
      await listActiveSessions(
        sql,
        String(a.workspace_id),
        a.limit ? Number(a.limit) : undefined,
      ),
    );
  }

  // ── Feature 5: Session templates ────────────────────────────────────────
  if (name === "sessions_create_template") {
    return text(await createSessionTemplate(sql, {
      workspace_id: String(a.workspace_id),
      name: String(a.name),
      system_prompt_template: String(a.system_prompt_template),
      description: a.description ? String(a.description) : undefined,
      variables: a.variables,
      default_model: a.default_model ? String(a.default_model) : undefined,
    }));
  }

  if (name === "sessions_render_template") {
    const result = await renderSessionTemplate(sql, String(a.template_id), a.variables as Record<string, string>);
    return result ? text(result) : text({ error: "Template not found" });
  }

  if (name === "sessions_list_templates") {
    return text(await listSessionTemplates(sql, String(a.workspace_id), {
      user_id: a.user_id ? String(a.user_id) : undefined,
      limit: a.limit ? Number(a.limit) : undefined,
    }));
  }

  if (name === "sessions_get_session_template") {
    return text(await getSessionTemplate(sql, String(a.template_id)));
  }

  if (name === "sessions_get_popular_templates") {
    return text(await getPopularTemplates(sql, String(a.workspace_id), {
      limit: a.limit ? Number(a.limit) : undefined,
    }));
  }

  if (name === "sessions_create_session_from_template") {
    const result = await createSessionFromTemplate(sql, String(a.template_id), String(a.user_id), a.variables as Record<string, string>, {
      workspace_id: String(a.workspace_id),
      title: a.title ? String(a.title) : undefined,
    });
    return result ? text(result) : text({ error: "Template not found" });
  }

  if (name === "sessions_delete_template") {
    return text({ deleted: await deleteSessionTemplate(sql, String(a.template_id)) });
  }

  // ── Feature 6: Session snapshots ──────────────────────────────────────────
  if (name === "sessions_create_snapshot") {
    return text(await createSessionSnapshot(sql, String(a.session_id), {
      label: a.label ? String(a.label) : undefined,
      description: a.description ? String(a.description) : undefined,
    }));
  }

  if (name === "sessions_list_snapshots") {
    return text(await listSessionSnapshots(sql, String(a.session_id), {
      limit: a.limit ? Number(a.limit) : undefined,
      offset: a.offset ? Number(a.offset) : undefined,
    }));
  }

  if (name === "sessions_get_snapshot") {
    const snap = await getSessionSnapshot(sql, String(a.snapshot_id));
    return snap ? text(snap) : text({ error: "Snapshot not found" });
  }

  if (name === "sessions_delete_snapshot") {
    const deleted = await deleteSessionSnapshot(sql, String(a.snapshot_id));
    return text({ deleted, snapshot_id: a.snapshot_id });
  }

  if (name === "sessions_compare_snapshots") {
    return text(await compareSnapshots(sql, String(a.snapshot_a), String(a.snapshot_b)));
  }

  if (name === "sessions_restore_from_snapshot") {
    return text(await restoreFromSnapshot(sql, String(a.session_id), String(a.snapshot_id)));
  }

  // ── Feature 7: Session diff ─────────────────────────────────────────────
  if (name === "sessions_diff") {
    return text(await diffSessions(sql, String(a.session_a), String(a.session_b)));
  }

  if (name === "sessions_find_common_ancestor") {
    const result = await findCommonAncestor(sql, String(a.session_a), String(a.session_b));
    return result ? text(result) : text({ error: "No common ancestor found" });
  }

  if (name === "sessions_diff_text") {
    return text(await generateSessionDiffText(sql, String(a.session_a), String(a.session_b), {
      maxLines: a.max_lines ? Number(a.max_lines) : undefined,
    }));
  }

  // ── Feature 8: Session annotations ─────────────────────────────────────────
  if (name === "sessions_create_annotation") {
    return text(await createAnnotation(sql, {
      session_id: String(a.session_id),
      annotation_type: String(a.annotation_type) as "bookmark" | "note" | "highlight" | "tag" | "issue",
      label: String(a.label),
      message_id: a.message_id ? String(a.message_id) : undefined,
      start_message_id: a.start_message_id ? String(a.start_message_id) : undefined,
      end_message_id: a.end_message_id ? String(a.end_message_id) : undefined,
      content: a.content as any,
      metadata: a.metadata as any,
      created_by: a.created_by ? String(a.created_by) : undefined,
    }));
  }

  if (name === "sessions_list_annotations") {
    return text(await listSessionAnnotations(sql, String(a.session_id), {
      annotation_type: a.annotation_type ? String(a.annotation_type) : undefined,
      created_by: a.created_by ? String(a.created_by) : undefined,
      limit: a.limit ? Number(a.limit) : undefined,
      offset: a.offset ? Number(a.offset) : undefined,
    }));
  }

  if (name === "sessions_get_annotation") {
    const ann = await getAnnotation(sql, String(a.id));
    return ann ? text(ann) : text({ error: "Annotation not found" });
  }

  if (name === "sessions_update_annotation") {
    return text(await updateAnnotation(sql, String(a.id), {
      label: a.label ? String(a.label) : undefined,
      content: a.content as any,
      metadata: a.metadata as any,
    }));
  }

  if (name === "sessions_delete_annotation") {
    return text({ deleted: await deleteAnnotation(sql, String(a.id)) });
  }

  if (name === "sessions_delete_all_annotations") {
    return text({ deleted_count: await deleteAllSessionAnnotations(sql, String(a.session_id)) });
  }

  if (name === "sessions_get_message_annotations") {
    return text(await getMessageAnnotations(sql, String(a.message_id)));
  }

  if (name === "sessions_annotation_stats") {
    const { getAnnotationStats } = await import("../lib/session-annotations.js");
    return text(await getAnnotationStats(sql, String(a.workspace_id), a.since ? String(a.since) : undefined));
  }

  // ── Feature 9: Retention policies ──────────────────────────────────────────
  if (name === "sessions_upsert_retention_policy") {
    return text(await upsertRetentionPolicy(sql, {
      id: a.id ? String(a.id) : undefined,
      workspace_id: a.workspace_id ? String(a.workspace_id) : undefined,
      user_id: a.user_id ? String(a.user_id) : undefined,
      name: String(a.name),
      description: a.description ? String(a.description) : undefined,
      scope: String(a.scope) as "workspace" | "user" | "global",
      retention_action: String(a.retention_action) as "archive" | "delete" | "snapshot_then_delete",
      min_age_days: a.min_age_days ? Number(a.min_age_days) : undefined,
      max_age_days: a.max_age_days ? Number(a.max_age_days) : undefined,
      conditions: a.conditions as any,
      enabled: a.enabled !== undefined ? Boolean(a.enabled) : undefined,
    }));
  }

  if (name === "sessions_set_retention_policy_enabled") {
    return text(await setRetentionPolicyEnabled(sql, String(a.id), Boolean(a.enabled)));
  }

  if (name === "sessions_get_retention_policy") {
    const pol = await getRetentionPolicy(sql, String(a.id));
    return pol ? text(pol) : text({ error: "Retention policy not found" });
  }

  if (name === "sessions_list_retention_policies") {
    return text(await listRetentionPolicies(sql, {
      workspace_id: a.workspace_id ? String(a.workspace_id) : undefined,
      user_id: a.user_id ? String(a.user_id) : undefined,
      scope: a.scope ? String(a.scope) : undefined,
      enabled: a.enabled !== undefined ? Boolean(a.enabled) : undefined,
      limit: a.limit ? Number(a.limit) : undefined,
    }));
  }

  if (name === "sessions_delete_retention_policy") {
    return text({ deleted: await deleteRetentionPolicy(sql, String(a.id)) });
  }

  if (name === "sessions_apply_retention_policy") {
    return text(await applyRetentionPolicy(sql, String(a.policy_id), Boolean(a.dry_run)));
  }

  // ── Feature 10: Session branching ──────────────────────────────────────────
  if (name === "sessions_transplant_fork") {
    return text(await transplantFork(sql, String(a.source_session_id), String(a.target_session_id), String(a.after_message_id), {
      archiveSource: a.archive_source !== undefined ? Boolean(a.archive_source) : undefined,
    }));
  }

  if (name === "sessions_rebase_fork") {
    return text(await rebaseFork(sql, String(a.session_id), String(a.new_parent_session_id), {
      preserveDepth: a.preserve_depth !== undefined ? Boolean(a.preserve_depth) : undefined,
    }));
  }

  if (name === "sessions_get_ancestors") {
    return text(await getSessionAncestors(sql, String(a.session_id)));
  }

  if (name === "sessions_find_merge_base") {
    const result = await findMergeBase(sql, String(a.session_a), String(a.session_b));
    return result ? text(result) : text({ error: "No merge base found" });
  }

  // ── Feature 10: Session tags ─────────────────────────────────────────────────
  if (name === "sessions_tag_session") {
    return text(await tagSession(sql, String(a.session_id), a.tags as string[], a.created_by ? String(a.created_by) : undefined));
  }

  if (name === "sessions_untag_session") {
    return text({ removed: await untagSession(sql, String(a.session_id), String(a.tag)) });
  }

  if (name === "sessions_list_tags") {
    return text(await listSessionTags(sql, String(a.session_id)));
  }

  if (name === "sessions_find_by_tag") {
    return text({ session_ids: await findSessionsByTag(sql, String(a.workspace_id), String(a.tag), a.limit ? Number(a.limit) : 50) });
  }

  if (name === "sessions_workspace_tags") {
    return text(await listWorkspaceTags(sql, String(a.workspace_id), a.limit ? Number(a.limit) : 100));
  }

  // ── Feature 11: Session bookmarks ─────────────────────────────────────────────
  if (name === "sessions_bookmark_message") {
    return text(await bookmarkMessage(sql, String(a.session_id), String(a.message_id), a.label ? String(a.label) : undefined, a.note ? String(a.note) : undefined, a.created_by ? String(a.created_by) : undefined));
  }

  if (name === "sessions_remove_bookmark") {
    return text({ removed: await removeBookmark(sql, String(a.session_id), String(a.message_id)) });
  }

  if (name === "sessions_list_bookmarks") {
    return text(await listSessionBookmarks(sql, String(a.session_id)));
  }

  if (name === "sessions_is_message_bookmarked") {
    return text({ bookmarked: await isMessageBookmarked(sql, String(a.session_id), String(a.message_id)) });
  }

  if (name === "sessions_bookmark_count") {
    return text({ count: await countSessionBookmarks(sql, String(a.session_id)) });
  }

  // ── Feature 12: Session metrics ────────────────────────────────────────────────
  if (name === "sessions_record_tokens") {
    await recordSessionTokens(sql, String(a.session_id), Number(a.prompt_tokens), Number(a.completion_tokens), a.cost_per_thousand_cents != null ? Number(a.cost_per_thousand_cents) : undefined);
    return text({ ok: true });
  }

  if (name === "sessions_record_response_time") {
    await recordResponseTime(sql, String(a.session_id), Number(a.response_time_ms));
    return text({ ok: true });
  }

  if (name === "sessions_get_metrics") {
    return text(await getSessionMetrics(sql, String(a.session_id)));
  }

  if (name === "sessions_top_token_sessions") {
    return text(await getTopTokenSessions(sql, String(a.workspace_id), a.limit ? Number(a.limit) : 20));
  }

  if (name === "sessions_workspace_usage") {
    return text(await getWorkspaceUsageTotals(sql, String(a.workspace_id)));
  }

  // Session importance
  if (name === "sessions_compute_importance") {
    return text(await computeAndStoreSessionImportance(sql, String(a.session_id), {
      messageCount: a.message_count,
      lastActivityHours: a.last_activity_hours,
      annotationCount: a.annotation_count,
      bookmarkCount: a.bookmark_count,
      forkCount: a.fork_count,
      isPinned: a.is_pinned,
      isArchived: a.is_archived,
      isForkPinned: a.is_fork_pinned,
      hasRootSession: a.has_root_session,
      tokenCount: a.token_count,
      daysOld: a.days_old,
      isPinnedOverride: a.is_pinned_override,
    }));
  }

  if (name === "sessions_get_importance") {
    return text(await getSessionImportance(sql, String(a.session_id)));
  }

  if (name === "sessions_list_by_importance") {
    return text(await listSessionsByImportance(sql, String(a.workspace_id), {
      minScore: a.min_score,
      limit: a.limit,
      offset: a.offset,
    }));
  }

  if (name === "sessions_list_at_risk") {
    return text(await listSessionsAtRisk(sql, String(a.workspace_id), {
      maxScore: a.max_score,
      minAgeDays: a.min_age_days,
      limit: a.limit,
    }));
  }

  // Fork lifecycle
  if (name === "sessions_init_fork_lifecycle") {
    return text(await initForkLifecycle(sql, String(a.fork_id), a.parent_session_id ? String(a.parent_session_id) : null));
  }

  if (name === "sessions_get_fork_lifecycle") {
    return text(await getForkLifecycle(sql, String(a.fork_id)));
  }

  if (name === "sessions_archive_fork") {
    return text(await archiveFork(sql, String(a.fork_id), a.reason ? String(a.reason) : undefined));
  }

  if (name === "sessions_delete_fork") {
    return text(await deleteFork(sql, String(a.fork_id)));
  }

  if (name === "sessions_promote_fork") {
    return text(await promoteFork(sql, String(a.fork_id), String(a.new_session_id)));
  }

  if (name === "sessions_list_forks_by_state") {
    return text(await listForksByState(sql, String(a.workspace_id), String(a.state), {
      limit: a.limit,
      offset: a.offset,
    }));
  }

  if (name === "sessions_get_fork_stats") {
    return text(await getForkStats(sql, String(a.workspace_id)));
  }

  if (name === "sessions_pin_fork") {
    return text(await pinFork(sql, String(a.fork_id), {
      pinnedBy: a.pinned_by ? String(a.pinned_by) : null,
      pinNote: a.pin_note ? String(a.pin_note) : null,
      autoProtect: a.auto_protect ?? true,
    }));
  }

  if (name === "sessions_unpin_fork") {
    const unpinned = await unpinFork(sql, String(a.fork_id), {
      pinNote: a.pin_note ? String(a.pin_note) : null,
    });
    return text({ unpinned });
  }

  if (name === "sessions_list_pinned_forks") {
    return text(await listPinnedForks(sql, String(a.workspace_id), {
      limit: a.limit,
      offset: a.offset,
    }));
  }

  if (name === "sessions_get_fork_pin") {
    return text(await getForkPin(sql, String(a.fork_id)));
  }

  if (name === "sessions_list_pinned_forks_by_user") {
    return text(await listPinnedForksByUser(sql, String(a.workspace_id), String(a.user_id), {
      limit: a.limit,
      offset: a.offset,
    }));
  }

  if (name === "sessions_bulk_pin_forks") {
    const { bulkPinForks: bulkPin } = await import("../lib/fork-pinning.js");
    return text(await bulkPin(sql, (a.fork_ids as string[]).map(String), {
      pinnedBy: a.pinned_by ? String(a.pinned_by) : null,
      pinNote: a.pin_note ? String(a.pin_note) : null,
      autoProtect: a.auto_protect ?? true,
    }));
  }

  if (name === "sessions_count_pinned_forks") {
    return text({ count: await countPinnedForks(sql, String(a.workspace_id)) });
  }

  if (name === "sessions_get_summary_settings") {
    return text(await getSummarySettings(sql, String(a.workspace_id)));
  }

  if (name === "sessions_update_summary_settings") {
    return text(await updateSummarySettings(sql, String(a.workspace_id), {
      default_keep_recent: a.default_keep_recent,
      default_target_tokens: a.default_target_tokens,
      auto_summarize_threshold: a.auto_summarize_threshold,
      summarize_model: a.summarize_model,
      enabled: a.enabled,
    }));
  }

  if (name === "sessions_should_auto_summarize") {
    return text(await shouldAutoSummarize(sql, String(a.workspace_id), Number(a.current_token_count)));
  }

  // Scheduled archival
  if (name === "sessions_schedule_archival") {
    return text(await createScheduledArchival(sql, {
      sessionId: String(a.session_id),
      scheduledFor: new Date(String(a.scheduled_for)),
      action: String(a.action),
      retentionPolicyId: a.retention_policy_id ? String(a.retention_policy_id) : undefined,
    }));
  }

  if (name === "sessions_cancel_archival") {
    return text({ cancelled: await cancelScheduledArchival(sql, String(a.archival_id)) });
  }

  if (name === "sessions_list_due_archivals") {
    return text(await listDueArchivals(sql, a.limit ? Number(a.limit) : 50));
  }

  if (name === "sessions_get_scheduled_archival") {
    return text(await getScheduledArchival(sql, String(a.archival_id)));
  }

  if (name === "sessions_list_pending_archivals") {
    return text(await listPendingArchivalsForSession(sql, String(a.session_id)));
  }

  if (name === "sessions_get_archival_stats") {
    return text(await getArchivalStats(sql, a.workspace_id ? String(a.workspace_id) : undefined));
  }

  // Retention policy rules (advanced)
  if (name === "sessions_create_retention_policy_rule") {
    return text(await createRetentionPolicy(sql, {
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      userId: a.user_id ? String(a.user_id) : undefined,
      name: String(a.name),
      trigger: String(a.trigger) as "age" | "importance_floor" | "access_count" | "manual",
      action: String(a.action) as "archive" | "soft_delete" | "hard_delete" | "summarize",
      ageThresholdDays: a.age_threshold_days ? Number(a.age_threshold_days) : undefined,
      importanceFloor: a.importance_floor ? Number(a.importance_floor) : undefined,
      accessCountFloor: a.access_count_floor ? Number(a.access_count_floor) : undefined,
      accessLookbackDays: a.access_lookback_days ? Number(a.access_lookback_days) : undefined,
      applyToForks: a.apply_to_forks !== undefined ? Boolean(a.apply_to_forks) : undefined,
      applyToRoot: a.apply_to_root !== undefined ? Boolean(a.apply_to_root) : undefined,
      retainPinned: a.retain_pinned !== undefined ? Boolean(a.retain_pinned) : undefined,
      dryRun: a.dry_run !== undefined ? Boolean(a.dry_run) : undefined,
      enabled: a.enabled !== undefined ? Boolean(a.enabled) : undefined,
    }));
  }

  if (name === "sessions_list_retention_policy_rules") {
    return text(await listRetentionPolicyRules(sql, String(a.workspace_id), {
      userId: a.user_id ? String(a.user_id) : undefined,
      trigger: a.trigger ? String(a.trigger) : undefined,
      action: a.action ? String(a.action) : undefined,
      enabled: a.enabled !== undefined ? Boolean(a.enabled) : undefined,
      limit: a.limit ? Number(a.limit) : undefined,
      offset: a.offset ? Number(a.offset) : undefined,
    }));
  }

  if (name === "sessions_execute_retention_policy_rule") {
    return text(await executeRetentionPolicy(sql, String(a.policy_id), a.dry_run !== undefined ? Boolean(a.dry_run) : false));
  }

  if (name === "sessions_execute_all_retention_rules") {
    return text(await executeAllRetentionPolicies(sql, String(a.workspace_id), a.dry_run !== undefined ? Boolean(a.dry_run) : false));
  }

  if (name === "sessions_get_retention_history") {
    return text(await getRetentionHistory(sql, String(a.workspace_id), {
      policyId: a.policy_id ? String(a.policy_id) : undefined,
      action: a.action ? String(a.action) : undefined,
      limit: a.limit ? Number(a.limit) : undefined,
      offset: a.offset ? Number(a.offset) : undefined,
    }));
  }

  // Context — estimate tokens
  if (name === "sessions_estimate_tokens") {
    const count = await estimateTokens(String(a.text), a.model ? String(a.model) : undefined);
    return text({ text: String(a.text), tokens: count });
  }

  // Conversation — update
  if (name === "sessions_update_conversation") {
    return text(await updateConversation(sql, String(a.conversation_id), {
      title: a.title ? String(a.title) : undefined,
      model: a.model ? String(a.model) : undefined,
      systemPrompt: a.system_prompt ? String(a.system_prompt) : undefined,
      metadata: a.metadata as any,
    }));
  }

  // Conversation — update summary
  if (name === "sessions_update_summary") {
    return text(await updateSummary(sql, String(a.conversation_id), String(a.summary), {
      summaryModel: a.summary_model ? String(a.summary_model) : undefined,
    }));
  }

  // Message — get
  if (name === "sessions_get_message") {
    return text(await getMessage(sql, String(a.message_id)));
  }

  // Message — delete
  if (name === "sessions_delete_message") {
    return text(await deleteMessage(sql, String(a.message_id)));
  }

  // Session summaries — list
  if (name === "sessions_list_summaries") {
    return text(await listSessionSummaries(sql, String(a.workspace_id), {
      conversationId: a.conversation_id ? String(a.conversation_id) : undefined,
      limit: a.limit ? Number(a.limit) : undefined,
    }));
  }

  // Tags — bulk tag
  if (name === "sessions_bulk_tag") {
    const { bulkTagSessions: bt } = await import("../lib/session-tags.js");
    return text(await bt(sql, String(a.workspace_id), a.session_ids as string[], String(a.tag)));
  }

  // Tags — update color
  if (name === "sessions_update_tag_color") {
    return text(await updateTagColor(sql, String(a.workspace_id), String(a.tag), String(a.color)));
  }

  // Tags — find orphans
  if (name === "sessions_find_orphan_tags") {
    return text(await findOrphanTags(sql, String(a.workspace_id)));
  }

  // Bookmarks — clear all
  if (name === "sessions_clear_bookmarks") {
    return text(await clearSessionBookmarks(sql, String(a.session_id)));
  }

  // Metrics — delete
  if (name === "sessions_delete_metrics") {
    return text(await deleteSessionMetrics(sql, String(a.session_id)));
  }

  // Snapshots — prune old
  if (name === "sessions_prune_snapshots") {
    return text(await pruneOldSnapshots(sql, String(a.workspace_id), a.older_than_days ? Number(a.older_than_days) : undefined));
  }

  // Templates — update
  if (name === "sessions_update_template") {
    return text(await updateSessionTemplate(sql, String(a.id), {
      name: a.name ? String(a.name) : undefined,
      description: a.description ? String(a.description) : undefined,
      body: a.body ? String(a.body) : undefined,
      variables: a.variables as any,
      isActive: a.is_active !== undefined ? Boolean(a.is_active) : undefined,
    }));
  }

  // Summary settings — delete
  if (name === "sessions_delete_summary_settings") {
    return text(await deleteSummarySettings(sql, String(a.workspace_id)));
  }

  // Retention — stats
  if (name === "sessions_get_retention_stats") {
    return text(await getRetentionStats(sql, String(a.workspace_id)));
  }

  // Scheduler — start archival
  if (name === "sessions_start_archival") {
    return text(await startArchival(sql, String(a.archival_id)));
  }

  // Scheduler — complete archival
  if (name === "sessions_complete_archival") {
    return text(await completeArchival(sql, String(a.archival_id)));
  }

  // Scheduler — fail archival
  if (name === "sessions_fail_archival") {
    return text(await failArchival(sql, String(a.archival_id), String(a.error)));
  }

  // Scheduler — schedule for policy
  if (name === "sessions_schedule_archivals_for_policy") {
    return text(await scheduleArchivalsForPolicy(sql, String(a.policy_id)));
  }

  // Fork lifecycle — orphan child forks
  if (name === "sessions_orphan_forks") {
    return text(await orphanChildForks(sql, String(a.parent_session_id)));
  }

  // Fork lifecycle — list stale orphaned forks
  if (name === "sessions_list_stale_forks") {
    const staleDays = a.stale_days ? Number(a.stale_days) : 30;
    return text(await listStaleOrphanedForks(sql, String(a.workspace_id), staleDays));
  }

  // Fork lifecycle — transition fork state
  if (name === "sessions_transition_fork") {
    return text(await transitionForkState(sql, String(a.fork_id), {
      newState: String(a.new_state) as any,
      preservationReason: a.preservation_reason ? String(a.preservation_reason) : undefined,
      promotedToSessionId: a.promoted_to_session_id ? String(a.promoted_to_session_id) : undefined,
    }));
  }

  // Snapshots — create point-in-time snapshot
  if (name === "sessions_snapshot_session") {
    return text(await createSessionSnapshot(sql, String(a.session_id), {
      label: a.label ? String(a.label) : undefined,
      description: a.description ? String(a.description) : undefined,
    }));
  }

  // Snapshots — get snapshot data without restoring
  if (name === "sessions_get_snapshot_data") {
    const snap = await getSessionSnapshot(sql, String(a.snapshot_id));
    return text(snap ? snap.snapshot_data : null);
  }

  // Templates — render template with variable substitution
  if (name === "sessions_render_template") {
    return text(await renderSessionTemplate(sql, String(a.template_id), a.variables as Record<string, string>));
  }

  // Templates — get most-used templates
  if (name === "sessions_get_popular_templates") {
    return text(await getPopularTemplates(sql, String(a.workspace_id), a.limit ? Number(a.limit) : 5));
  }

  // Session importance — recompute all scores for a workspace
  if (name === "sessions_recompute_all_importance") {
    const count = await recomputeAllSessionImportance(sql, String(a.workspace_id));
    return text({ recomputed: count });
  }

  // Fork lifecycle — record fork access
  if (name === "sessions_record_fork_access") {
    await recordForkAccess(sql, String(a.fork_id));
    return text({ recorded: true });
  }

  // Fork pinning — check if fork is pinned
  if (name === "sessions_is_fork_pinned") {
    const pinned = await isForkPinned(sql, String(a.fork_id));
    return text({ is_pinned: pinned });
  }

  // Fork pinning — get pin details
  if (name === "sessions_get_pin_details") {
    return text(await getPinDetails(sql, String(a.fork_id)));
  }

  // Bookmarks — count bookmarks in a session
  if (name === "sessions_count_session_bookmarks") {
    const { countSessionBookmarks } = await import("../lib/session-bookmarks.js");
    return text({ count: await countSessionBookmarks(sql, String(a.session_id)) });
  }

  // Metrics — delete session metrics (privacy/GDPR)
  if (name === "sessions_delete_session_metrics") {
    const { deleteSessionMetrics } = await import("../lib/session-metrics.js");
    return text({ deleted: await deleteSessionMetrics(sql, String(a.session_id)) });
  }

  // Session diff — diff two sessions and return structured differences
  if (name === "sessions_diff_sessions") {
    const { diffSessions } = await import("../lib/session-diff.js");
    return text(await diffSessions(sql, String(a.session_a_id), String(a.session_b_id)));
  }

  // ─── Fork Lifecycle Management ──────────────────────────────────────────────

  if (name === "sessions_get_fork_lifecycle") {
    const { getForkLifecycle } = await import("../lib/fork-lifecycle.js");
    return text(await getForkLifecycle(sql, String(a.session_id)));
  }

  if (name === "sessions_init_fork_lifecycle") {
    const { initForkLifecycle } = await import("../lib/fork-lifecycle.js");
    return text(await initForkLifecycle(sql, String(a.session_id)));
  }

  if (name === "sessions_transition_fork_state") {
    const { transitionForkState } = await import("../lib/fork-lifecycle.js");
    return text(await transitionForkState(sql, String(a.session_id), String(a.target_state)));
  }

  if (name === "sessions_promote_fork") {
    const { promoteFork } = await import("../lib/fork-lifecycle.js");
    return text(await promoteFork(sql, String(a.fork_id), String(a.promote_to)));
  }

  if (name === "sessions_archive_fork") {
    const { archiveFork } = await import("../lib/fork-lifecycle.js");
    return text(await archiveFork(sql, String(a.fork_id)));
  }

  if (name === "sessions_list_forks_by_state") {
    const { listForksByState } = await import("../lib/fork-lifecycle.js");
    return text(await listForksByState(sql, String(a.workspace_id), String(a.state)));
  }

  if (name === "sessions_get_fork_stats") {
    const { getForkStats } = await import("../lib/fork-lifecycle.js");
    return text(await getForkStats(sql, String(a.workspace_id)));
  }

  if (name === "sessions_list_stale_orphaned_forks") {
    const { listStaleOrphanedForks } = await import("../lib/fork-lifecycle.js");
    return text(await listStaleOrphanedForks(sql, String(a.workspace_id), a.stale_threshold_days ? Number(a.stale_threshold_days) : 30));
  }

  // ─── Session Tags ───────────────────────────────────────────────────────────

  if (name === "sessions_tag_session") {
    const { tagSession } = await import("../lib/session-tags.js");
    return text(await tagSession(sql, String(a.session_id), String(a.tag)));
  }

  if (name === "sessions_untag_session") {
    const { untagSession } = await import("../lib/session-tags.js");
    return text({ removed: await untagSession(sql, String(a.session_id), String(a.tag)) });
  }

  if (name === "sessions_list_session_tags") {
    const { listSessionTags } = await import("../lib/session-tags.js");
    return text(await listSessionTags(sql, String(a.session_id)));
  }

  if (name === "sessions_find_sessions_by_tag") {
    const { findSessionsByTag } = await import("../lib/session-tags.js");
    return text(await findSessionsByTag(sql, String(a.workspace_id), String(a.tag), a.limit ? Number(a.limit) : 20));
  }

  if (name === "sessions_bulk_tag") {
    const { bulkTagSessions } = await import("../lib/session-tags.js");
    return text({ tagged: await bulkTagSessions(sql, String(a.workspace_id), a.session_ids.split(","), String(a.tag)) });
  }

  if (name === "sessions_clear_session_tags") {
    const { clearSessionTags } = await import("../lib/session-tags.js");
    return text({ cleared: await clearSessionTags(sql, String(a.session_id)) });
  }

  // ─── Retention Policies ─────────────────────────────────────────────────────

  if (name === "sessions_apply_retention_policy") {
    const { applyRetentionPolicy } = await import("../lib/session-retention.js");
    return text({ applied: await applyRetentionPolicy(sql, String(a.workspace_id)) });
  }

  if (name === "sessions_get_retention_stats") {
    const { getRetentionStats } = await import("../lib/session-retention.js");
    return text(await getRetentionStats(sql, String(a.workspace_id)));
  }

  if (name === "sessions_upsert_retention_policy") {
    const { upsertRetentionPolicy } = await import("../lib/session-retention.js");
    return text(await upsertRetentionPolicy(sql, String(a.workspace_id), {
      maxAgeDays: a.max_age_days ? Number(a.max_age_days) : undefined,
      maxMessages: a.max_messages ? Number(a.max_messages) : undefined,
      scope: a.scope ? String(a.scope) : undefined,
      action: a.action ? String(a.action) : undefined,
    }));
  }

  // ─── Session Importance ───────────────────────────────────────────────────────

  if (name === "sessions_get_session_importance") {
    const { getSessionImportance } = await import("../lib/session-importance.js");
    return text(await getSessionImportance(sql, String(a.session_id)));
  }

  if (name === "sessions_list_by_importance") {
    const { listSessionsByImportance } = await import("../lib/session-importance.js");
    return text(await listSessionsByImportance(sql, String(a.workspace_id), a.min_score ? Number(a.min_score) : 0.5, a.limit ? Number(a.limit) : 20));
  }

  if (name === "sessions_list_at_risk") {
    const { listSessionsAtRisk } = await import("../lib/session-importance.js");
    return text(await listSessionsAtRisk(sql, String(a.workspace_id)));
  }

  // ─── Session Templates ───────────────────────────────────────────────────────

  if (name === "sessions_get_template") {
    const { getSessionTemplate } = await import("../lib/session-templates.js");
    return text(await getSessionTemplate(sql, String(a.template_id)));
  }

  if (name === "sessions_list_templates") {
    const { listSessionTemplates } = await import("../lib/session-templates.js");
    return text(await listSessionTemplates(sql, String(a.workspace_id), a.limit ? Number(a.limit) : 20));
  }

  if (name === "sessions_render_template") {
    const { renderSessionTemplate } = await import("../lib/session-templates.js");
    return text(await renderSessionTemplate(sql, String(a.template_id), a.variables ? JSON.parse(a.variables) : {}));
  }

  // ─── Context Window ──────────────────────────────────────────────────────────

  if (name === "sessions_get_context_window") {
    const { getContextWindow } = await import("../lib/context.js");
    return text(await getContextWindow(sql, String(a.session_id)));
  }

  if (name === "sessions_estimate_tokens") {
    const { estimateTokens } = await import("../lib/context.js");
    return text({ tokens: await estimateTokens(String(a.text)) });
  }

  // ─── Session Lineage ─────────────────────────────────────────────────────────

  if (name === "sessions_get_lineage") {
    const { getSessionLineage } = await import("../lib/session-forks.js");
    return text(await getSessionLineage(sql, String(a.session_id)));
  }

  if (name === "sessions_find_common_ancestor") {
    const { findCommonAncestor } = await import("../lib/session-diff.js");
    return text(await findCommonAncestor(sql, String(a.session_a_id), String(a.session_b_id)));
  }

  // ─── Session Sharing ──────────────────────────────────────────────────────────

  if (name === "sessions_share_session") {
    const { shareSession } = await import("../lib/session-sharing.js");
    return text(await shareSession(
      sql, String(a.session_id), String(a.share_type) as "user" | "team",
      String(a.principal_id), String(a.role) as any, String(a.shared_by),
      a.expires_at ? String(a.expires_at) : undefined, a.note ? String(a.note) : undefined,
    ));
  }

  if (name === "sessions_revoke_share") {
    const { revokeSessionShare } = await import("../lib/session-sharing.js");
    return text({ revoked: await revokeSessionShare(
      sql, String(a.session_id), String(a.share_type) as "user" | "team", String(a.principal_id),
    ) });
  }

  if (name === "sessions_list_shares") {
    const { listSessionShares } = await import("../lib/session-sharing.js");
    return text(await listSessionShares(sql, String(a.session_id)));
  }

  if (name === "sessions_list_shared_with_me") {
    const { listSharedWithMe } = await import("../lib/session-sharing.js");
    return text(await listSharedWithMe(sql, String(a.user_id), a.limit ? Number(a.limit) : 50, a.offset ? Number(a.offset) : 0));
  }

  if (name === "sessions_check_access") {
    const { checkSessionAccess } = await import("../lib/session-sharing.js");
    return text({ has_access: await checkSessionAccess(
      sql, String(a.session_id), String(a.principal_id),
      String(a.principal_type) as "user" | "team", String(a.min_role) as any,
    ) });
  }

  if (name === "sessions_bulk_share") {
    const { bulkShareSession } = await import("../lib/session-sharing.js");
    return text({ count: await bulkShareSession(
      sql, String(a.session_id), a.shares.map((s: any) => ({
        share_type: s.share_type as "user" | "team",
        principal_id: String(s.principal_id),
        role: s.role as any,
      })), String(a.shared_by),
    ) });
  }

  // ─── Content Filtering ─────────────────────────────────────────────────────────

  if (name === "sessions_redact_content") {
    const { redactContent } = await import("../lib/content-filter.js");
    return text(redactContent(String(a.text), a.patterns as any));
  }

  if (name === "sessions_detect_sensitive") {
    const { detectSensitiveContent } = await import("../lib/content-filter.js");
    return text(detectSensitiveContent(String(a.text)));
  }

  if (name === "sessions_redact_messages") {
    const { redactMessages } = await import("../lib/content-filter.js");
    return text(await redactMessages(a.messages, a.patterns as any));
  }

  // ─── Session Merge ─────────────────────────────────────────────────────────────

  if (name === "sessions_three_way_merge") {
    const { threeWayMerge } = await import("../lib/session-merge.js");
    return text(await threeWayMerge(sql, {
      sourceSessionId: String(a.source_session_id),
      targetSessionId: String(a.target_session_id),
      ancestorSessionId: String(a.ancestor_session_id),
      newSessionTitle: a.new_session_title ? String(a.new_session_title) : undefined,
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      userId: a.user_id ? String(a.user_id) : undefined,
      conflictStrategy: a.conflict_strategy as any,
      archiveSource: a.archive_source as boolean | undefined,
      archiveTarget: a.archive_target as boolean | undefined,
    }));
  }

  // ─── Summary Search ───────────────────────────────────────────────────────────
  if (name === "sessions_search_summaries") {
    const pattern = `%${String(a.query)}%`;
    const limit = a.limit ? Number(a.limit) : 20;
    const offset = a.offset ? Number(a.offset) : 0;
    const rows = await sql`
      SELECT c.id, c.workspace_id, c.user_id, c.title, c.summary,
             c.summary_tokens, c.message_count, c.updated_at, c.created_at
      FROM sessions.conversations c
      WHERE c.workspace_id = ${String(a.workspace_id)}
        AND c.summary IS NOT NULL
        AND c.summary ILIKE ${pattern}
      ORDER BY c.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return text({ sessions: rows, count: rows.length });
  }

  // ─── Bulk Pin ─────────────────────────────────────────────────────────────────
  if (name === "sessions_bulk_pin") {
    const ids = (a.session_ids as string[]).map(String);
    const results: { session_id: string; pinned: boolean }[] = [];
    for (const sid of ids) {
      try {
        await pinSession(sql, sid);
        results.push({ session_id: sid, pinned: true });
      } catch {
        results.push({ session_id: sid, pinned: false });
      }
    }
    return text({ results, pinned_count: results.filter(r => r.pinned).length });
  }

  // ─── Recent Sessions ───────────────────────────────────────────────────────────
  if (name === "sessions_list_recent") {
    const limit = a.limit ? Number(a.limit) : 20;
    const offset = a.offset ? Number(a.offset) : 0;
    const rows = await sql`
      SELECT c.id, c.workspace_id, c.user_id, c.title, c.model,
             c.summary, c.message_count, c.total_tokens, c.is_pinned,
             c.is_fork_pinned, c.fork_depth, c.parent_id, c.root_id,
             c.created_at, c.updated_at,
             MAX(m.created_at) AS last_message_at
      FROM sessions.conversations c
      LEFT JOIN sessions.messages m ON m.conversation_id = c.id
      WHERE c.workspace_id = ${String(a.workspace_id)}
        AND c.is_archived = false
      GROUP BY c.id
      ORDER BY last_message_at DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `;
    return text({ sessions: rows, count: rows.length });
  }

  // ─── Conversation Stats ────────────────────────────────────────────────────────
  if (name === "sessions_get_conversation_stats") {
    const since = a.since ? new Date(String(a.since)) : new Date(Date.now() - 30 * 86400000);
    const userFilter = a.user_id ? sql`AND c.user_id = ${String(a.user_id)}` : sql``;
    const [stats] = await sql`
      SELECT
        COUNT(DISTINCT c.id)::int AS total_conversations,
        COUNT(DISTINCT m.id)::int AS total_messages,
        COALESCE(SUM(m.tokens), 0)::int AS total_tokens,
        COUNT(DISTINCT c.parent_id)::int AS total_forks,
        COUNT(DISTINCT CASE WHEN c.is_pinned THEN c.id END)::int AS pinned_count,
        COUNT(DISTINCT CASE WHEN c.is_fork_pinned THEN c.id END)::int AS fork_pinned_count,
        MIN(c.created_at) AS oldest_conversation,
        MAX(c.updated_at) AS newest_activity
      FROM sessions.conversations c
      LEFT JOIN sessions.messages m ON m.conversation_id = c.id
      WHERE c.workspace_id = ${String(a.workspace_id)}
        AND c.created_at >= ${since}
        ${userFilter}
    `;
    const [activeCount] = await sql`
      SELECT COUNT(DISTINCT c.id)::int AS active_sessions
      FROM sessions.conversations c
      WHERE c.workspace_id = ${String(a.workspace_id)}
        AND c.updated_at >= ${since}
        ${userFilter}
    `;
    return text({ workspace_id: a.workspace_id, period_start: since.toISOString(), ...stats, active_sessions: activeCount.active_sessions });
  }

  // ─── Search Shared Sessions ───────────────────────────────────────────────────
  if (name === "sessions_search_shared") {
    const limit = a.limit ? Number(a.limit) : 20;
    const offset = a.offset ? Number(a.offset) : 0;
    const pattern = `%${String(a.query ?? "")}%`;
    const roleFilter = a.role ? sql`AND sh.role = ${String(a.role)}` : sql``;
    const rows = await sql`
      SELECT DISTINCT c.id, c.workspace_id, c.user_id, c.title, c.model,
             c.summary, c.message_count, c.total_tokens, c.is_pinned,
             c.created_at, c.updated_at, sh.role, sh.shared_at
      FROM sessions.conversations c
      JOIN sessions.session_shares sh ON sh.session_id = c.id
      WHERE c.workspace_id = ${String(a.workspace_id)}
        AND sh.share_type = 'user'
        AND sh.principal_id = ${String(a.user_id)}
        AND (${a.query ? sql`c.title ILIKE ${pattern} OR c.summary ILIKE ${pattern}` : sql`true`}
        OR ${a.query ? sql`c.id ILIKE ${pattern}` : sql`true`})
        ${roleFilter}
      ORDER BY sh.shared_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return text({ sessions: rows, count: rows.length });
  }

  // ─── Activity Overview ────────────────────────────────────────────────────────
  if (name === "sessions_get_activity_overview") {
    const days = a.days ? Number(a.days) : 30;
    const since = new Date(Date.now() - days * 86400000);
    const userFilter = a.user_id ? sql`AND c.user_id = ${String(a.user_id)}` : sql``;

    // Messages per day
    const messagesPerDay = await sql`
      SELECT
        DATE(m.created_at) AS day,
        COUNT(m.id)::int AS message_count,
        COUNT(DISTINCT c.id)::int AS active_sessions,
        COALESCE(SUM(m.tokens), 0)::int AS tokens
      FROM sessions.messages m
      JOIN sessions.conversations c ON c.id = m.conversation_id
      WHERE c.workspace_id = ${String(a.workspace_id)}
        AND m.created_at >= ${since}
        ${userFilter}
      GROUP BY DATE(m.created_at)
      ORDER BY day DESC
    `;

    // Top users by volume
    const topUsers = await sql`
      SELECT
        c.user_id,
        COUNT(m.id)::int AS message_count,
        COALESCE(SUM(m.tokens), 0)::int AS total_tokens,
        COUNT(DISTINCT c.id)::int AS session_count
      FROM sessions.messages m
      JOIN sessions.conversations c ON c.id = m.conversation_id
      WHERE c.workspace_id = ${String(a.workspace_id)}
        AND m.created_at >= ${since}
        ${userFilter}
      GROUP BY c.user_id
      ORDER BY message_count DESC
      LIMIT 10
    `;

    // Summary totals
    const [totals] = await sql`
      SELECT
        COUNT(DISTINCT m.id)::int AS total_messages,
        COALESCE(SUM(m.tokens), 0)::int AS total_tokens,
        COUNT(DISTINCT c.id)::int AS total_active_sessions
      FROM sessions.messages m
      JOIN sessions.conversations c ON c.id = m.conversation_id
      WHERE c.workspace_id = ${String(a.workspace_id)}
        AND m.created_at >= ${since}
        ${userFilter}
    `;

    return text({
      workspace_id: a.workspace_id,
      period_days: days,
      period_start: since.toISOString(),
      totals,
      messages_per_day: messagesPerDay,
      top_users: topUsers,
    });
  }

  // sessions_link_external — link session to external service ID
  if (name === "sessions_link_external") {
    const link = await linkSessionToExternal(sql, {
      conversationId: String(a.conversation_id),
      externalService: String(a.external_service),
      externalId: String(a.external_id),
      linkType: a.link_type ? String(a.link_type) : undefined,
      metadata: a.metadata as Record<string, string | number | boolean> | undefined,
    });
    return text(link);
  }

  // sessions_get_links — get all external links for a session
  if (name === "sessions_get_links") {
    const links = await getSessionLinks(sql, String(a.conversation_id));
    return text({ conversation_id: a.conversation_id, links });
  }

  // sessions_get_by_external_id — find sessions by external ID
  if (name === "sessions_get_by_external_id") {
    const links = await getSessionsByExternalId(sql, String(a.external_service), String(a.external_id));
    return text({ external_service: a.external_service, external_id: a.external_id, links });
  }

  // sessions_delete_link — delete a specific link
  if (name === "sessions_delete_link") {
    await deleteSessionLink(sql, String(a.id));
    return text({ deleted: true, id: a.id });
  }

  // sessions_delete_all_links — delete all links for a session
  if (name === "sessions_delete_all_links") {
    const count = await deleteAllSessionLinks(sql, String(a.conversation_id));
    return text({ deleted: count, conversation_id: a.conversation_id });
  }

  // sessions_export_replay — export session in replayable format
  if (name === "sessions_export_replay") {
    const replay = await exportSessionReplay(sql, String(a.conversation_id));
    return text(replay);
  }

  // sessions_export_diff — export diff between two sessions
  if (name === "sessions_export_diff") {
    const diff = await exportSessionDiff(sql, String(a.base_session_id), String(a.compare_session_id));
    return text(diff);
  }

  // sessions_export_archive — export multiple sessions in archive format
  if (name === "sessions_export_archive") {
    const archive = await exportSessionArchive(sql, a.conversation_ids as string[]);
    return text(archive);
  }

  // ─── Auto summarization ──────────────────────────────────────────────────────
  if (name === "sessions_get_sessions_needing_summarization") {
    return text(
      await getSessionsNeedingSummarization(sql, {
        workspaceId: String(a.workspace_id),
        minTokens: a.min_tokens ? Number(a.min_tokens) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
      }),
    );
  }

  if (name === "sessions_process_auto_summarization") {
    return text(
      await processAutoSummarization(sql, {
        workspaceId: String(a.workspace_id),
        batchLimit: a.batch_limit ? Number(a.batch_limit) : undefined,
        minTokens: a.min_tokens ? Number(a.min_tokens) : undefined,
      }),
    );
  }

  if (name === "sessions_get_context_window_fill") {
    return text(
      await getContextWindowFill(sql, String(a.session_id), {
        maxTokens: a.max_tokens ? Number(a.max_tokens) : undefined,
      }),
    );
  }

  // ─── Branch comparison ──────────────────────────────────────────────────────
  if (name === "sessions_compare_branches") {
    return text(
      await compareBranches(sql, String(a.session_a_id), String(a.session_b_id), {
        includeMessages: a.include_messages ?? false,
      }),
    );
  }

  if (name === "sessions_list_branch_pairs") {
    return text(
      await listAllBranchPairs(sql, String(a.root_session_id), {
        minDivergenceMessages: a.min_divergence_messages
          ? Number(a.min_divergence_messages)
          : undefined,
      }),
    );
  }

  if (name === "sessions_create_retention_policy") {
    return text(
      await createRetentionPolicy(sql, {
        workspaceId: String(a.workspace_id),
        name: String(a.name),
        trigger: a.trigger as any,
        action: a.action as any,
        ageThresholdDays: a.age_threshold_days ? Number(a.age_threshold_days) : undefined,
        importanceFloor: a.importance_floor ? Number(a.importance_floor) : undefined,
        accessCountFloor: a.access_count_floor ? Number(a.access_count_floor) : undefined,
        accessLookbackDays: a.access_lookback_days ? Number(a.access_lookback_days) : undefined,
        applyToForks: a.apply_to_forks,
        applyToRoot: a.apply_to_root,
        retainPinned: a.retain_pinned,
        dryRun: a.dry_run,
      }),
    );
  }

  if (name === "sessions_execute_retention_policy") {
    return text(
      await executeRetentionPolicy(sql, String(a.policy_id)),
    );
  }

  if (name === "sessions_execute_all_retention_policies") {
    return text(
      await executeAllRetentionPolicies(sql, String(a.workspace_id), {
        dryRun: a.dry_run ?? false,
      }),
    );
  }

  if (name === "sessions_reschedule_archival") {
    return text(
      await rescheduleArchival(sql, String(a.archival_id), new Date(String(a.new_scheduled_for))),
    );
  }

  if (name === "sessions_cancel_scheduled_archival") {
    return text(
      { cancelled: await cancelScheduledArchival(sql, String(a.archival_id)) },
    );
  }

  if (name === "sessions_list_pending_archivals_for_session") {
    return text(
      await listPendingArchivalsForSession(sql, String(a.session_id)),
    );
  }

  if (name === "sessions_bulk_schedule_archival") {
    const scheduledFor = new Date(String(a.scheduled_for));
    const action = String(a.action) as "archive" | "delete" | "snapshot_then_delete" | "summarize";
    const results: { session_id: string; archival_id: string | null; error?: string }[] = [];
    for (const sid of (a.session_ids as string[]).slice(0, 200)) {
      try {
        const arch = await createScheduledArchival(sql, {
          sessionId: String(sid),
          scheduledFor,
          action,
          retentionPolicyId: a.retention_policy_id ? String(a.retention_policy_id) : undefined,
        });
        results.push({ session_id: sid, archival_id: arch.id });
      } catch (e) {
        results.push({ session_id: sid, archival_id: null, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return text({
      total: results.length,
      scheduled: results.filter(r => r.archival_id !== null).length,
      errors: results.filter(r => r.error).length,
      results,
    });
  }

  if (name === "sessions_list_workspace_scheduled_archivals") {
    const limit = a.limit ? Number(a.limit) : 50;
    const offset = a.offset ? Number(a.offset) : 0;
    const statusFilter = a.status ? sql`AND sa.status = ${String(a.status)}` : sql``;
    const actionFilter = a.action ? sql`AND sa.action = ${String(a.action)}` : sql``;
    const rows = await sql`
      SELECT sa.*, c.title as session_title, c.workspace_id
      FROM sessions.scheduled_archivals sa
      JOIN sessions.conversations c ON c.id = sa.session_id
      WHERE c.workspace_id = ${String(a.workspace_id)}
        ${statusFilter}
        ${actionFilter}
      ORDER BY sa.scheduled_for ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return text({ workspace_id: a.workspace_id, archivals: rows, count: rows.length, limit, offset });
  }

  if (name === "sessions_get_retention_policy_rules") {
    const limit = a.limit ? Number(a.limit) : 50;
    const offset = a.offset ? Number(a.offset) : 0;
    const enabledFilter = a.enabled !== undefined ? sql`AND enabled = ${a.enabled}` : sql``;
    const triggerFilter = a.trigger ? sql`AND trigger = ${String(a.trigger)}` : sql``;
    const actionFilter = a.action ? sql`AND action = ${String(a.action)}` : sql``;
    const rows = await sql`
      SELECT * FROM sessions.retention_policies
      WHERE workspace_id = ${String(a.workspace_id)}
        ${enabledFilter}
        ${triggerFilter}
        ${actionFilter}
      ORDER BY created_at ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return text({ workspace_id: a.workspace_id, policies: rows, count: rows.length, limit, offset });
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
