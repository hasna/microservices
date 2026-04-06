// ─── Channel Priority ─────────────────────────────────────────────────────────

server.tool(
  "notify_set_channel_priority",
  "Set the base delivery priority for a channel in a workspace (higher = more urgent)",
  {
    workspace_id: z.string(),
    channel: z.string(),
    priority: z.number().int().min(1).max(10).describe("Priority 1-10 (10 = highest)"),
  },
  async ({ workspace_id, channel, priority }) => {
    const { setChannelPriority } = await import("../lib/prioritization.js");
    return text(await setChannelPriority(sql, workspace_id, channel, priority));
  },
);

server.tool(
  "notify_get_channel_priority",
  "Get the current priority and boost rules for a channel",
  {
    workspace_id: z.string(),
    channel: z.string(),
  },
  async ({ workspace_id, channel }) => {
    const { getChannelPriority } = await import("../lib/prioritization.js");
    return text(await getChannelPriority(sql, workspace_id, channel));
  },
);

server.tool(
  "notify_add_priority_rule",
  "Add a conditional priority boost rule (e.g., boost email by 2 when user has unread notifications > 5)",
  {
    workspace_id: z.string(),
    channel: z.string(),
    condition: z.string().describe("JSON condition e.g. {'unread_count': {'$gt': 5}}"),
    boost: z.number().int().describe("Priority boost amount (1-5)"),
    reason: z.string().optional(),
  },
  async ({ workspace_id, channel, condition, boost, reason }) => {
    const { addPriorityRule } = await import("../lib/prioritization.js");
    return text(await addPriorityRule(sql, workspace_id, channel, JSON.parse(condition), boost, reason));
  },
);

server.tool(
  "notify_reschedule_by_priority",
  "Reschedule pending notifications based on updated channel priority matrix",
  {
    workspace_id: z.string(),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ workspace_id, dry_run }) => {
    const { rescheduleByPriority } = await import("../lib/prioritization.js");
    return text({ rescheduled: dry_run ? 0 : await rescheduleByPriority(sql, workspace_id) });
  },
);

