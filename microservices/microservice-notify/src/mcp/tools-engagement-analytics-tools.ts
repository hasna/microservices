// --- Engagement Analytics tools ---

server.tool(
  "notify_engagement_time_series",
  "Get time-series engagement data (delivered/read/clicked over time) for a workspace",
  {
    workspace_id: z.string(),
    since: z.string().optional().describe("ISO 8601 datetime start"),
    until: z.string().optional().describe("ISO 8601 datetime end"),
    channel: ChannelSchema.optional(),
    granularity: z.enum(["day", "hour"]).optional().default("day"),
  },
  async ({ workspace_id, since, until, channel, granularity }) =>
    text(await getEngagementTimeSeries(sql, workspace_id, {
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      channel,
      granularity,
    })),
);

server.tool(
  "notify_engagement_funnel",
  "Get a conversion funnel (delivered → read → clicked) for a workspace",
  {
    workspace_id: z.string(),
    since: z.string().optional().describe("ISO 8601 datetime start"),
    until: z.string().optional().describe("ISO 8601 datetime end"),
  },
  async ({ workspace_id, since, until }) =>
    text(await getEngagementFunnel(sql, workspace_id,
      since ? new Date(since) : undefined,
      until ? new Date(until) : undefined,
    )),
);

