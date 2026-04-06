// ─── Delivery Windows ─────────────────────────────────────────────────────────

server.tool(
  "notify_create_delivery_window",
  "Create a delivery window restricting when notifications can be sent for a user+channel",
  {
    user_id: z.string().describe("User ID"),
    channel: z.string().describe("Channel (email, in_app, sms, etc.)"),
    day_of_week: z.array(z.number().int().min(0).max(6)).optional().default([0, 1, 2, 3, 4, 5, 6]),
    start_hour: z.number().int().min(0).max(23).optional().default(9),
    start_minute: z.number().int().min(0).max(59).optional().default(0),
    end_hour: z.number().int().min(0).max(23).optional().default(21),
    end_minute: z.number().int().min(0).max(59).optional().default(0),
    timezone: z.string().optional().default("UTC"),
  },
  async (opts) => {
    const { createDeliveryWindow } = await import("../lib/delivery-windows.js");
    return text(await createDeliveryWindow(sql, opts.user_id, opts.channel, {
      dayOfWeek: opts.day_of_week,
      startHour: opts.start_hour,
      startMinute: opts.start_minute,
      endHour: opts.end_hour,
      endMinute: opts.end_minute,
      timezone: opts.timezone,
    }));
  },
);

server.tool(
  "notify_check_delivery_window",
  "Check if current time is within a user's delivery window",
  { user_id: z.string(), channel: z.string() },
  async ({ user_id, channel }) => {
    const { checkDeliveryWindow } = await import("../lib/delivery-windows.js");
    return text(await checkDeliveryWindow(sql, user_id, channel));
  },
);

server.tool(
  "notify_hold_for_window",
  "Hold a notification until the next open delivery window",
  { notification_id: z.string(), user_id: z.string(), channel: z.string() },
  async ({ notification_id, user_id, channel }) => {
    const { holdForWindow } = await import("../lib/delivery-windows.js");
    return text({ held_until: await holdForWindow(sql, notification_id, user_id, channel) });
  },
);

server.tool(
  "notify_list_delivery_windows",
  "List all delivery windows for a user",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { listUserDeliveryWindows } = await import("../lib/delivery-windows.js");
    return text(await listUserDeliveryWindows(sql, user_id));
  },
);

server.tool(
  "notify_delete_delivery_window",
  "Delete a delivery window",
  { id: z.string() },
  async ({ id }) => {
    const { deleteDeliveryWindow } = await import("../lib/delivery-windows.js");
    await deleteDeliveryWindow(sql, id);
    return text({ deleted: true });
  },
);

