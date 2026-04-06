// ─── Retry Management ──────────────────────────────────────────────────────────

server.tool(
  "notify_get_retry_health",
  "Get retry subsystem health summary: dead letter queue size, oldest retry age, success rate",
  async () => {
    const { getRetryHealth } = await import("../lib/retry.js");
    return text(await getRetryHealth(sql));
  },
);

server.tool(
  "notify_drain_failed_retries",
  "Drain and delete all failed retries that have exceeded max retry count",
  {
    workspace_id: z.string().optional(),
    before: z.string().optional().describe("ISO timestamp — only drain retries created before this time"),
  },
  async ({ workspace_id, before }) => {
    const { drainFailedRetries } = await import("../lib/retry.js");
    return text({ drained: await drainFailedRetries(sql, workspace_id, before ? new Date(before) : undefined) });
  },
);

server.tool(
  "notify_clear_retries",
  "Clear (delete) all pending retry records for a notification",
  { notification_id: z.string() },
  async ({ notification_id }) => {
    const { clearRetries } = await import("../lib/retry.js");
    return text({ cleared: await clearRetries(sql, notification_id) });
  },
);

server.tool(
  "notify_get_due_retries",
  "Get retries that are due for the next delivery attempt",
  { limit: z.number().optional().default(50) },
  async ({ limit }) => {
    const { getDueRetries } = await import("../lib/retry.js");
    return text(await getDueRetries(sql, limit));
  },
);

