  // ─── Session Tags ───────────────────────────────────────────────────────────

  if (name === "sessions_tag_session") {
    const { tagSession } = await import("../lib/session-tags.js");
    return text(await tagSession(sql, String(a.session_id), String(a.tag)));
  }

  if (name === "sessions_untag_session") {
    const { untagSession } = await import("../lib/session-tags.js");
    return text({ removed: await untagSession(sql, String(a.session_id), String(a.tag)) });
  }

  if (name === "sessions_list_session_tags") {
    const { listSessionTags } = await import("../lib/session-tags.js");
    return text(await listSessionTags(sql, String(a.session_id)));
  }

  if (name === "sessions_find_sessions_by_tag") {
    const { findSessionsByTag } = await import("../lib/session-tags.js");
    return text(await findSessionsByTag(sql, String(a.workspace_id), String(a.tag), a.limit ? Number(a.limit) : 20));
  }

  if (name === "sessions_bulk_tag") {
    const { bulkTagSessions } = await import("../lib/session-tags.js");
    return text({ tagged: await bulkTagSessions(sql, String(a.workspace_id), a.session_ids.split(","), String(a.tag)) });
  }

  if (name === "sessions_clear_session_tags") {
    const { clearSessionTags } = await import("../lib/session-tags.js");
    return text({ cleared: await clearSessionTags(sql, String(a.session_id)) });
  }

