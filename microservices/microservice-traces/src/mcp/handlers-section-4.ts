  // Retention handlers
  if (name === "traces_upsert_retention_policy") {
    return text(await upsertRetentionPolicy(sql, {
      workspace_id: a.workspace_id ? String(a.workspace_id) : undefined,
      name: String(a.name),
      type: String(a.type),
      days: a.days ? Number(a.days) : undefined,
      max_count: a.max_count ? Number(a.max_count) : undefined,
      enabled: a.enabled,
    }));
  }

  if (name === "traces_list_retention_policies") {
    return text(await listRetentionPolicies(sql, a.workspace_id ? String(a.workspace_id) : undefined));
  }

  if (name === "traces_run_retention") {
    return text(await runRetentionPolicies(sql, String(a.workspace_id)));
  }

  if (name === "traces_retention_stats") {
    return text(await getRetentionStats(sql, String(a.workspace_id)));
  }

