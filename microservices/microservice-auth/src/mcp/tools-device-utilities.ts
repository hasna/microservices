// --- Device utilities ---

server.tool(
  "auth_touch_device",
  "Update the last-seen timestamp on a device",
  { device_id: z.string() },
  async ({ device_id }) => text({ updated: await touchDevice(sql, device_id) }),
);

