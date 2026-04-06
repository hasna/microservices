// --- Engagement analytics: funnel ---
server.tool(
  "notify_get_engagement_funnel",
  "Get a conversion funnel for a workspace: delivered → read → clicked",
  {
    workspace_id: z.string(),
    since: z.string().optional(),
    until: z.string().optional(),
  },
  async ({ workspace_id, since, until }) => {
    const sinceDate = since ? new Date(since) : undefined;
    const untilDate = until ? new Date(until) : undefined;
    return text(await getEngagementFunnel(sql, workspace_id, sinceDate, untilDate));
  },
);

