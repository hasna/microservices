// --- Batch Queue tools ---

server.tool(
  "notify_enqueue_batch",
  "Enqueue multiple notifications for batch processing",
  {
    notifications: z.array(z.object({
      user_id: z.string(),
      workspace_id: z.string().optional(),
      channel: ChannelSchema,
      type: z.string(),
      title: z.string().optional(),
      body: z.string(),
      data: z.record(z.any()).optional(),
      priority: z.number().int().min(0).max(10).optional(),
      scheduled_at: z.string().optional().describe("ISO 8601 datetime"),
    })),
  },
  async ({ notifications }) => {
    const queued: QueuedNotification[] = notifications.map((n) => ({
      userId: n.user_id,
      workspaceId: n.workspace_id ?? "",
      channel: n.channel,
      type: n.type,
      title: n.title ?? "",
      body: n.body,
      data: n.data,
      priority: n.priority ?? 5,
      scheduledAt: n.scheduled_at ? new Date(n.scheduled_at) : undefined,
    }));
    const result = await enqueueBatchNotifications(sql, queued);
    return text(result);
  },
);

server.tool(
  "notify_dequeue_batch",
  "Dequeue notifications for processing from the batch queue",
  {
    limit: z.number().int().positive().optional().default(100),
    channels: z.array(ChannelSchema).optional(),
  },
  async ({ limit, channels }) => {
    const items = await dequeueBatchNotifications(sql, limit, channels);
    return text({ items });
  },
);

server.tool(
  "notify_batch_queue_stats",
  "Get batch queue statistics",
  async () => {
    const stats = await getBatchQueueStats(sql);
    return text({ stats });
  },
);

server.tool(
  "notify_mark_batch_delivered",
  "Mark batch notification items as delivered",
  { ids: z.array(z.string()) },
  async ({ ids }) => {
    const uuidIds = ids.map((id) => {
      const parsed = parseInt(id, 10);
      return isNaN(parsed) ? id : parsed;
    });
    await markBatchDelivered(sql, uuidIds as number[]);
    return text({ ok: true });
  },
);

server.tool(
  "notify_mark_batch_failed",
  "Mark batch notification items as failed",
  {
    ids: z.array(z.string()),
    reason: z.string().optional(),
  },
  async ({ ids, reason }) => {
    const uuidIds = ids.map((id) => {
      const parsed = parseInt(id, 10);
      return isNaN(parsed) ? id : parsed;
    });
    await markBatchFailed(sql, uuidIds as number[], reason);
    return text({ ok: true });
  },
);

