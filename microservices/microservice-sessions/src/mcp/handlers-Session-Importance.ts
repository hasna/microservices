  // ─── Session Importance ───────────────────────────────────────────────────────

  if (name === "sessions_get_session_importance") {
    const { getSessionImportance } = await import("../lib/session-importance.js");
    return text(await getSessionImportance(sql, String(a.session_id)));
  }

  if (name === "sessions_list_by_importance") {
    const { listSessionsByImportance } = await import("../lib/session-importance.js");
    return text(await listSessionsByImportance(sql, String(a.workspace_id), a.min_score ? Number(a.min_score) : 0.5, a.limit ? Number(a.limit) : 20));
  }

  if (name === "sessions_list_at_risk") {
    const { listSessionsAtRisk } = await import("../lib/session-importance.js");
    return text(await listSessionsAtRisk(sql, String(a.workspace_id)));
  }

