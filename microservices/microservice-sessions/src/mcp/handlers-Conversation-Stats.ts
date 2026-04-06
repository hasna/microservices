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

