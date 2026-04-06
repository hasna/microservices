// --- Retry Health tools ---

server.tool(
  "notify_retry_subsystem_health",
  "Get retry subsystem health — checks for stuck retries, high failure rates, returns overall health score (0-100)",
  {},
  async () => text(JSON.stringify(await getRetrySubsystemHealth(sql), null, 2)),
);

server.tool(
  "notify_drain_failed_retries",
  "Retrieve all permanently failed retries (exceeded max retries) with last error details for forensics",
  {
    workspace_id: z.string().optional(),
    channel: z.string().optional(),
    since_hours: z.number().optional().default(24),
    limit: z.number().optional().default(100),
  },
  async ({ workspace_id, channel, since_hours, limit }) => {
    const since = new Date(Date.now() - since_hours * 3600_000);
    return text(JSON.stringify(
      await drainFailedRetries(sql, { workspaceId: workspace_id, channel, since, limit }),
      null, 2
    ));
  },
);

