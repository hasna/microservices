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

