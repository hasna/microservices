  // ─── Context Window ──────────────────────────────────────────────────────────

  if (name === "sessions_get_context_window") {
    const { getContextWindow } = await import("../lib/context.js");
    return text(await getContextWindow(sql, String(a.session_id)));
  }

  if (name === "sessions_estimate_tokens") {
    const { estimateTokens } = await import("../lib/context.js");
    return text({ tokens: await estimateTokens(String(a.text)) });
  }

