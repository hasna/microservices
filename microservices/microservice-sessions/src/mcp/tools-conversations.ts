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
