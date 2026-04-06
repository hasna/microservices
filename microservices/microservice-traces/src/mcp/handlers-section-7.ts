  // Sampling analytics handlers
  if (name === "traces_record_sampling_decision") {
    await recordSamplingDecision(sql, {
      traceId: a.trace_id ? String(a.trace_id) : undefined,
      workspaceId: String(a.workspace_id),
      policyId: a.policy_id ? String(a.policy_id) : undefined,
      policyName: a.policy_name ? String(a.policy_name) : undefined,
      policyType: String(a.policy_type),
      decision: a.decision as "sampled" | "dropped",
      reason: String(a.reason),
    });
    return text({ ok: true });
  }

  if (name === "traces_sampling_stats") {
    return text(await getSamplingStats(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_list_sampling_decisions") {
    return text(await listSamplingDecisions(
      sql,
      String(a.workspace_id),
      {
        limit: a.limit ? Number(a.limit) : undefined,
        offset: a.offset ? Number(a.offset) : undefined,
        decision: a.decision as "sampled" | "dropped" | undefined,
        since: a.since ? new Date(String(a.since)) : undefined,
      },
    ));
  }

  if (name === "traces_evaluate_sampling") {
    return text(await evaluateSampling(
      sql,
      String(a.workspace_id),
      { spanType: a.span_type ? String(a.span_type) : undefined },
    ));
  }

  if (name === "traces_bulk_evaluate_sampling") {
    return text(await bulkEvaluateSampling(sql, a.trace_ids as string[]));
  }

  if (name === "traces_overall_sampling_rate") {
    return text(await getOverallSamplingRate(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

