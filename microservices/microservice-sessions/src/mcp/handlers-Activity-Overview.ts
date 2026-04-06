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

