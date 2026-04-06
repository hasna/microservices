// --- Batch queue operations ---

server.tool(
  "notify_enqueue_batch_notifications",
  "Enqueue a batch of notifications for delivery processing",
  {
    notifications: z.array(z.object({
      user_id: z.string(),
      workspace_id: z.string(),
      channel: z.string(),
      type: z.string(),
      title: z.string(),
      body: z.string(),
      data: z.record(z.any()).optional(),
      priority: z.number().int().optional().default(5),
      scheduled_at: z.string().optional().describe("ISO timestamp for delayed delivery"),
    })),
  },
  async ({ notifications }) => {
    const { enqueueBatchNotifications } = await import("../lib/batch-queue.js");
    return text(await enqueueBatchNotifications(sql, notifications));
  },
);

server.tool(
  "notify_get_batch_queue_stats",
  "Get current batch notification queue statistics — pending, processing, completed, failed counts and oldest pending age",
  {},
  async () => {
    const { getBatchQueueStats } = await import("../lib/batch-queue.js");
    return text(await getBatchQueueStats(sql));
  },
);

server.tool(
  "notify_dequeue_batch_notifications",
  "Dequeue pending notifications from the batch delivery queue for processing",
  {
    limit: z.number().int().positive().optional().default(100).describe("Maximum notifications to dequeue"),
    channels: z.array(z.string()).optional().describe("Filter to specific channel types"),
  },
  async ({ limit, channels }) => {
    const { dequeueBatchNotifications } = await import("../lib/batch-queue.js");
    return text({ notifications: await dequeueBatchNotifications(sql, limit, channels) });
  },
);

