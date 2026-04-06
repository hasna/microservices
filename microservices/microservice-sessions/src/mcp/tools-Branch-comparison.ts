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
