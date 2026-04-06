// --- Engagement analytics: time series ---
server.tool(
  "notify_get_engagement_time_series",
  "Get engagement time-series data for a workspace over a date range",
  {
    workspace_id: z.string(),
    since: z.string().optional(),
    until: z.string().optional(),
    channel: z.string().optional(),
    granularity: z.enum(["day", "hour"]).optional(),
  },
  async ({ workspace_id, since, until, channel, granularity }) => {
    const sinceDate = since ? new Date(since) : undefined;
    const untilDate = until ? new Date(until) : undefined;
    return text(await getEngagementTimeSeries(sql, workspace_id, {
      since: sinceDate,
      until: untilDate,
      channel,
      granularity,
    }));
  },
);

