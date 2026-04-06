// --- Receipt stats ---
server.tool(
  "notify_get_receipt_stats",
  "Get aggregate delivery receipt statistics per channel — delivered, bounced, dropped, failed counts and delivery rate",
  {
    workspace_id: z.string().optional(),
    channel: z.string().optional(),
    since: z.string().optional().describe("ISO date — start of window"),
    until: z.string().optional().describe("ISO date — end of window"),
  },
  async ({ workspace_id, channel, since, until }) => {
    const sinceDate = since ? new Date(since) : undefined;
    const untilDate = until ? new Date(until) : undefined;
    return text(await getReceiptStats(sql, { workspaceId: workspace_id, channel, since: sinceDate, until: untilDate }));
  },
);

