  // Sampling handlers
  if (name === "traces_upsert_sampling_policy") {
    return text(await upsertSamplingPolicy(sql, {
      workspace_id: a.workspace_id ? String(a.workspace_id) : undefined,
      name: String(a.name),
      type: String(a.type),
      rate: Number(a.rate),
      span_types: a.span_types,
      threshold_ms: a.threshold_ms ? Number(a.threshold_ms) : undefined,
      threshold_usd: a.threshold_usd ? Number(a.threshold_usd) : undefined,
      enabled: a.enabled,
      priority: a.priority ? Number(a.priority) : undefined,
    }));
  }

  if (name === "traces_list_sampling_policies") {
    return text(await listSamplingPolicies(sql, a.workspace_id ? String(a.workspace_id) : undefined));
  }

  if (name === "traces_delete_sampling_policy") {
    return text({ deleted: await deleteSamplingPolicy(sql, String(a.id)) });
  }

  if (name === "traces_should_sample") {
    return text(await shouldSample(
      sql,
      String(a.workspace_id),
      a.span_type ? String(a.span_type) : undefined,
    ));
  }

