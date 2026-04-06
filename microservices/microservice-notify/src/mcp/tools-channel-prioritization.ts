// --- Channel prioritization ---

server.tool(
  "notify_set_channel_priority",
  "Set the delivery priority for a channel (higher = delivered first)",
  {
    channel_id: z.string(),
    priority: z.number().int().min(0).max(10),
  },
  async ({ channel_id, priority }) => {
    await setChannelPriority(sql, channel_id, priority);
    return text({ ok: true, priority });
  },
);

server.tool(
  "notify_get_delivery_queue",
  "Get pending delivery records ordered by priority DESC, created_at ASC",
  {
    limit: z.number().optional().default(50),
  },
  async ({ limit }) => text(await getDeliveryQueue(sql, limit)),
);

server.tool(
  "notify_get_channel_priority",
  "Get the current priority level for a channel",
  { channel_id: z.string() },
  async ({ channel_id }) => text(await getChannelPriority(sql, channel_id)),
);

server.tool(
  "notify_get_channel_stats",
  "Get per-channel delivery/read/click statistics for a workspace — shows delivered, read, clicked, and total counts per channel type (email, sms, push, etc.)",
  {
    workspace_id: z.string(),
    since: z.string().optional().describe("ISO timestamp — if provided, stats are filtered to notifications created after this time"),
  },
  async ({ workspace_id, since }) =>
    text(await getChannelStats(sql, workspace_id, since ? new Date(since) : undefined)),
);

server.tool(
  "notify_get_pending_scheduled",
  "List pending scheduled notifications due before a given time — used by workers to pick up due items",
  {
    before: z.string().describe("ISO timestamp — return notifications scheduled for before this time"),
    limit: z.number().optional().default(50).describe("Max notifications to return"),
  },
  async ({ before, limit }) => {
    const pending = await getPendingScheduled(sql, new Date(before), limit);
    return text({ pending, count: pending.length });
  },
);

server.tool(
  "notify_reschedule_by_priority",
  "Reschedule pending delivery records for a channel to a new priority",
  {
    channel_id: z.string(),
    new_priority: z.number().int().min(0).max(10),
  },
  async ({ channel_id, new_priority }) => {
    const count = await rescheduleByPriority(sql, channel_id, new_priority);
    return text({ updated: count });
  },
);

