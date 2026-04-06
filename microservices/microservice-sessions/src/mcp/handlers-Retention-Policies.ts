  // ─── Retention Policies ─────────────────────────────────────────────────────

  if (name === "sessions_apply_retention_policy") {
    const { applyRetentionPolicy } = await import("../lib/session-retention.js");
    return text({ applied: await applyRetentionPolicy(sql, String(a.workspace_id)) });
  }

  if (name === "sessions_get_retention_stats") {
    const { getRetentionStats } = await import("../lib/session-retention.js");
    return text(await getRetentionStats(sql, String(a.workspace_id)));
  }

  if (name === "sessions_upsert_retention_policy") {
    const { upsertRetentionPolicy } = await import("../lib/session-retention.js");
    return text(await upsertRetentionPolicy(sql, String(a.workspace_id), {
      maxAgeDays: a.max_age_days ? Number(a.max_age_days) : undefined,
      maxMessages: a.max_messages ? Number(a.max_messages) : undefined,
      scope: a.scope ? String(a.scope) : undefined,
      action: a.action ? String(a.action) : undefined,
    }));
  }

