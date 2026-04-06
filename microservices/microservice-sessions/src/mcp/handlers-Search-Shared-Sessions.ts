  // ─── Search Shared Sessions ───────────────────────────────────────────────────
  if (name === "sessions_search_shared") {
    const limit = a.limit ? Number(a.limit) : 20;
    const offset = a.offset ? Number(a.offset) : 0;
    const pattern = `%${String(a.query ?? "")}%`;
    const roleFilter = a.role ? sql`AND sh.role = ${String(a.role)}` : sql``;
    const rows = await sql`
      SELECT DISTINCT c.id, c.workspace_id, c.user_id, c.title, c.model,
             c.summary, c.message_count, c.total_tokens, c.is_pinned,
             c.created_at, c.updated_at, sh.role, sh.shared_at
      FROM sessions.conversations c
      JOIN sessions.session_shares sh ON sh.session_id = c.id
      WHERE c.workspace_id = ${String(a.workspace_id)}
        AND sh.share_type = 'user'
        AND sh.principal_id = ${String(a.user_id)}
        AND (${a.query ? sql`c.title ILIKE ${pattern} OR c.summary ILIKE ${pattern}` : sql`true`}
        OR ${a.query ? sql`c.id ILIKE ${pattern}` : sql`true`})
        ${roleFilter}
      ORDER BY sh.shared_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return text({ sessions: rows, count: rows.length });
  }

