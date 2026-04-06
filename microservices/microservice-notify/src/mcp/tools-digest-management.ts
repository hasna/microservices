// ─── Digest Management ─────────────────────────────────────────────────────────

server.tool(
  "notify_create_digest",
  "Create a one-time or recurring notification digest for a user",
  {
    user_id: z.string(),
    channel: z.enum(["email", "sms", "push"]).default("email"),
    schedule: z.enum(["daily", "weekly", "monthly"]),
    workspace_id: z.string().optional(),
    filters: z.record(z.any()).optional().describe("Filter criteria for included notifications"),
  },
  async ({ user_id, channel, schedule, workspace_id, filters }) => {
    const { createDigest } = await import("../lib/digests.js");
    return text(await createDigest(sql, { userId: user_id, channel, schedule, workspaceId: workspace_id, filters }));
  },
);

server.tool(
  "notify_list_digests",
  "List notification digests for a user",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { listDigests } = await import("../lib/digests.js");
    return text(await listDigests(sql, user_id));
  },
);

server.tool(
  "notify_render_digest_body",
  "Render a digest's body with current notification content",
  {
    digest_id: z.string(),
    include_notifications: z.boolean().optional().default(true),
  },
  async ({ digest_id, include_notifications }) => {
    const { renderDigestBody } = await import("../lib/digests.js");
    return text(await renderDigestBody(sql, digest_id, include_notifications));
  },
);

server.tool(
  "notify_cancel_digest",
  "Cancel a notification digest by ID",
  { digest_id: z.string() },
  async ({ digest_id }) => {
    const { cancelDigest } = await import("../lib/digests.js");
    return text({ cancelled: await cancelDigest(sql, digest_id) });
  },
);

