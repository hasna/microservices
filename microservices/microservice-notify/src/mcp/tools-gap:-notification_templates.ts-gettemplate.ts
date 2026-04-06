// --- Gap: notification_templates.ts getTemplate ---

server.tool(
  "notify_get_notification_template",
  "Get a notification template by ID (notification_templates table with workspace support)",
  { id: z.string() },
  async ({ id }) => text(await getNotificationTemplate(sql, id)),
);

