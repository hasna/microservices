// --- Scheduling conflict detection ---

server.tool(
  "notify_get_schedule_conflicts",
  "Detect overlapping scheduled notifications for a user/channel within a time window — useful for digest merging or rate-limit avoidance",
  {
    user_id: z.string(),
    channel_type: z.string(),
    window_minutes: z.number().int().positive().optional().default(60),
    after: z.string().optional().describe("ISO timestamp — window start (defaults to now)"),
  },
  async ({ user_id, channel_type, window_minutes, after }) => {
    const { getScheduleConflicts } = await import("../lib/scheduled.js");
    return text(await getScheduleConflicts(sql, { userId: user_id, channelType: channel_type, windowMinutes: window_minutes, after: after ? new Date(after) : undefined }));
  },
);

