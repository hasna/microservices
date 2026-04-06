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

