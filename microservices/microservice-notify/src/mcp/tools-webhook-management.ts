// ─── Webhook Management ───────────────────────────────────────────────────────

server.tool(
  "notify_create_webhook",
  "Create a webhook endpoint for workspace event notifications",
  {
    workspace_id: z.string(),
    url: z.string().url().describe("Webhook endpoint URL"),
    events: z.array(z.enum(["notification_sent", "notification_clicked", "notification_read", "notification_failed", "digest_ready"])).describe("Event types to subscribe to"),
    secret: z.string().optional().describe("HMAC secret for payload signature verification"),
    name: z.string().optional(),
  },
  async ({ workspace_id, url, events, secret, name }) => {
    const { createWebhookEndpoint } = await import("../lib/webhooks.js");
    return text(await createWebhookEndpoint(sql, { workspaceId: workspace_id, url, events, secret, name }));
  },
);

server.tool(
  "notify_list_webhooks",
  "List all webhook endpoints configured for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const { listWorkspaceWebhooks } = await import("../lib/webhooks.js");
    return text(await listWorkspaceWebhooks(sql, workspace_id));
  },
);

server.tool(
  "notify_delete_webhook",
  "Delete a webhook endpoint by ID",
  { webhook_id: z.string() },
  async ({ webhook_id }) => {
    const { deleteWebhookEndpoint } = await import("../lib/webhooks.js");
    return text({ deleted: await deleteWebhookEndpoint(sql, webhook_id) });
  },
);

