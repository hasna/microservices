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

