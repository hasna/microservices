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

