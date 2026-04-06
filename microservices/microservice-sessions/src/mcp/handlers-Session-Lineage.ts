  // ─── Session Lineage ─────────────────────────────────────────────────────────

  if (name === "sessions_get_lineage") {
    const { getSessionLineage } = await import("../lib/session-forks.js");
    return text(await getSessionLineage(sql, String(a.session_id)));
  }

  if (name === "sessions_find_common_ancestor") {
    const { findCommonAncestor } = await import("../lib/session-diff.js");
    return text(await findCommonAncestor(sql, String(a.session_a_id), String(a.session_b_id)));
  }

