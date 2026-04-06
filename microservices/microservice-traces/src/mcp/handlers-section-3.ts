  // Correlation handlers
  if (name === "traces_link_trace") {
    return text(await linkTrace(sql, {
      trace_id: String(a.trace_id),
      session_id: a.session_id ? String(a.session_id) : undefined,
      user_id: a.user_id ? String(a.user_id) : undefined,
      external_request_id: a.external_request_id ? String(a.external_request_id) : undefined,
      external_trace_id: a.external_trace_id ? String(a.external_trace_id) : undefined,
    }));
  }

  if (name === "traces_get_by_session") {
    return text(await getTracesBySession(sql, String(a.session_id), a.limit ? Number(a.limit) : 50));
  }

  if (name === "traces_get_by_user") {
    return text(await getTracesByUser(sql, String(a.user_id), a.limit ? Number(a.limit) : 50));
  }

  if (name === "traces_get_by_external_request_id") {
    return text(await getTraceByExternalRequestId(sql, String(a.external_request_id)));
  }

