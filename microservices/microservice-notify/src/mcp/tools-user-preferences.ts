// ─── User Preferences ─────────────────────────────────────────────────────────

server.tool(
  "notify_set_preference",
  "Set a user's notification preference for a channel/type",
  {
    user_id: z.string(),
    channel: z.string(),
    notification_type: z.string().optional(),
    enabled: z.boolean().describe("Enable or disable this preference"),
    quiet_hours_start: z.string().optional().describe("HH:MM local time"),
    quiet_hours_end: z.string().optional(),
  },
  async ({ user_id, channel, notification_type, enabled, quiet_hours_start, quiet_hours_end }) => {
    const { setPreference } = await import("../lib/preferences.js");
    return text(await setPreference(sql, { userId: user_id, channel, notificationType: notification_type, enabled, quietHoursStart: quiet_hours_start, quietHoursEnd: quiet_hours_end }));
  },
);

server.tool(
  "notify_get_preference",
  "Get a user's notification preference for a specific channel",
  {
    user_id: z.string(),
    channel: z.string(),
    notification_type: z.string().optional(),
  },
  async ({ user_id, channel, notification_type }) => {
    const { getPreference } = await import("../lib/preferences.js");
    return text(await getPreference(sql, user_id, channel, notification_type));
  },
);

server.tool(
  "notify_is_channel_enabled",
  "Check if a notification channel is enabled for a user",
  {
    user_id: z.string(),
    channel: z.string(),
  },
  async ({ user_id, channel }) => {
    const { isChannelEnabled } = await import("../lib/preferences.js");
    return text({ enabled: await isChannelEnabled(sql, user_id, channel) });
  },
);

