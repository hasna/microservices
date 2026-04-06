  // ─── Auto summarization ──────────────────────────────────────────────────────
  if (name === "sessions_get_sessions_needing_summarization") {
    return text(
      await getSessionsNeedingSummarization(sql, {
        workspaceId: String(a.workspace_id),
        minTokens: a.min_tokens ? Number(a.min_tokens) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
      }),
    );
  }

  if (name === "sessions_process_auto_summarization") {
    return text(
      await processAutoSummarization(sql, {
        workspaceId: String(a.workspace_id),
        batchLimit: a.batch_limit ? Number(a.batch_limit) : undefined,
        minTokens: a.min_tokens ? Number(a.min_tokens) : undefined,
      }),
    );
  }

  if (name === "sessions_get_context_window_fill") {
    return text(
      await getContextWindowFill(sql, String(a.session_id), {
        maxTokens: a.max_tokens ? Number(a.max_tokens) : undefined,
      }),
    );
  }

