// --- Record delivery ---
server.tool(
  "notify_record_delivery",
  "Record that a notification was successfully delivered to a channel",
  {
    notification_id: z.string(),
    channel_type: z.string(),
    metadata: z.record(z.any()).optional(),
  },
  async ({ notification_id, channel_type, metadata }) => {
    await recordDelivery(sql, notification_id, channel_type, metadata);
    return text({ recorded: true });
  },
);

