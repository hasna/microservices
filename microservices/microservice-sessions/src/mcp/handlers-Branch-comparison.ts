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
