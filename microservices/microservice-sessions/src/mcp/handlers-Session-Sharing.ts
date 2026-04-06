  // ─── Session Sharing ──────────────────────────────────────────────────────────

  if (name === "sessions_share_session") {
    const { shareSession } = await import("../lib/session-sharing.js");
    return text(await shareSession(
      sql, String(a.session_id), String(a.share_type) as "user" | "team",
      String(a.principal_id), String(a.role) as any, String(a.shared_by),
      a.expires_at ? String(a.expires_at) : undefined, a.note ? String(a.note) : undefined,
    ));
  }

  if (name === "sessions_revoke_share") {
    const { revokeSessionShare } = await import("../lib/session-sharing.js");
    return text({ revoked: await revokeSessionShare(
      sql, String(a.session_id), String(a.share_type) as "user" | "team", String(a.principal_id),
    ) });
  }

  if (name === "sessions_list_shares") {
    const { listSessionShares } = await import("../lib/session-sharing.js");
    return text(await listSessionShares(sql, String(a.session_id)));
  }

  if (name === "sessions_list_shared_with_me") {
    const { listSharedWithMe } = await import("../lib/session-sharing.js");
    return text(await listSharedWithMe(sql, String(a.user_id), a.limit ? Number(a.limit) : 50, a.offset ? Number(a.offset) : 0));
  }

  if (name === "sessions_check_access") {
    const { checkSessionAccess } = await import("../lib/session-sharing.js");
    return text({ has_access: await checkSessionAccess(
      sql, String(a.session_id), String(a.principal_id),
      String(a.principal_type) as "user" | "team", String(a.min_role) as any,
    ) });
  }

  if (name === "sessions_bulk_share") {
    const { bulkShareSession } = await import("../lib/session-sharing.js");
    return text({ count: await bulkShareSession(
      sql, String(a.session_id), a.shares.map((s: any) => ({
        share_type: s.share_type as "user" | "team",
        principal_id: String(s.principal_id),
        role: s.role as any,
      })), String(a.shared_by),
    ) });
  }

