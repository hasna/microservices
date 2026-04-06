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

