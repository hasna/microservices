// --- Channel priority rules ---
server.tool(
  "notify_add_priority_rule",
  "Add a priority boost rule for a channel — rules are evaluated in order when scheduling",
  {
    workspace_id: z.string(),
    channel_type: z.string(),
    condition: z.string().describe("Condition expression (e.g. 'urgency >= high')"),
    boost_score: z.number().describe("Boost score to add when condition matches"),
    description: z.string().optional(),
  },
  async ({ workspace_id, channel_type, condition, boost_score, description }) => {
    await addPriorityRule(sql, workspace_id, channel_type, { condition, boostScore: boost_score, description });
    return text({ added: true });
  },
);

server.tool(
  "notify_get_priority_matrix",
  "Get the full channel priority matrix for a workspace — shows all priorities and active rules",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => {
    const matrix = await getChannelPriorityMatrix(sql, workspace_id);
    return text(matrix);
  },
);

server.tool(
  "notify_reschedule_by_priority",
  "Reschedule all notifications for a channel to a new priority level",
  {
    channel_type: z.string(),
    new_priority: z.number().int().min(1).max(100),
  },
  async ({ channel_type, new_priority }) => {
    const count = await rescheduleByPriority(sql, channel_type, new_priority);
    return text({ rescheduled: count });
  },
);

server.tool(
  "notify_detect_scheduling_overlaps",
  "Detect overlapping scheduled notification windows for a user — finds notifications that could be merged into a digest",
  {
    user_id: z.string(),
    channel_type: z.string(),
    window_hours: z.number().optional().default(1).describe("Window size in hours"),
    after: z.string().optional().describe("ISO timestamp — window start (defaults to now)"),
  },
  async ({ user_id, channel_type, window_hours, after }) => {
    const conflicts = await getScheduleConflicts(sql, {
      userId: user_id,
      channelType: channel_type,
      windowMinutes: (window_hours ?? 1) * 60,
      after: after ? new Date(after) : undefined,
    });
    return text(conflicts);
  },
);

server.tool(
  "notify_reschedule_notification",
  "Reschedule a notification to a new delivery time",
  {
    notification_id: z.string(),
    new_scheduled_at: z.string().describe("ISO timestamp for new delivery time"),
  },
  async ({ notification_id, new_scheduled_at }) => {
    const result = await rescheduleNotification(sql, notification_id, new Date(new_scheduled_at));
    return text({ rescheduled: result });
  },
);

server.tool(
  "notify_cancel_scheduled",
  "Cancel a scheduled notification that has not yet been delivered",
  {
    notification_id: z.string(),
  },
  async ({ notification_id }) => {
    const cancelled = await cancelNotification(sql, notification_id);
    return text({ cancelled });
  },
);

server.tool(
  "notify_mark_all_read",
  "Mark all unread notifications as read for a user",
  {
    user_id: z.string(),
  },
  async ({ user_id }) => {
    await markAllRead(sql, user_id);
    return text({ marked: true });
  },
);

