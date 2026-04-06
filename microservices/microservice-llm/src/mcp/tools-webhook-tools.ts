// --- Webhook tools ---

server.tool(
  "llm_register_webhook",
  "Register a webhook endpoint for budget/circuit notifications",
  {
    workspace_id: z.string().describe("Workspace ID"),
    url: z.string().describe("Webhook URL (must be HTTPS)"),
    secret: z.string().describe("Shared secret for signing payloads"),
    event_types: z.array(z.enum([
      "budget_threshold",
      "budget_exceeded",
      "model_budget_exceeded",
      "circuit_open",
      "circuit_close",
    ])).describe("Event types to subscribe to"),
  },
  async ({ workspace_id, url, secret, event_types }) =>
    text(await registerWebhook(sql, { workspaceId: workspace_id, url, secret, eventTypes: event_types as any[] })),
);

server.tool(
  "llm_delete_webhook",
  "Delete a registered webhook endpoint",
  {
    workspace_id: z.string().describe("Workspace ID"),
    webhook_id: z.string().describe("Webhook ID to delete"),
  },
  async ({ workspace_id, webhook_id }) => {
    await deleteWebhook(sql, webhook_id, workspace_id);
    return text({ deleted: true });
  },
);

server.tool(
  "llm_list_webhooks",
  "List all registered webhook endpoints for a workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await listWebhooks(sql, workspace_id)),
);

server.tool(
  "llm_fire_webhook",
  "Manually fire a webhook to a specific URL with a payload (for testing)",
  {
    url: z.string().describe("Webhook URL"),
    secret: z.string().describe("Webhook secret for HMAC signature"),
    event: z.string().describe("Event type"),
    workspace_id: z.string().describe("Workspace ID"),
    data: z.record(z.unknown()).optional().describe("Event data payload"),
  },
  async ({ url, secret, event, workspace_id, data }) => {
    const result = await fireWebhook(url, secret, {
      event: event as WebhookEventType,
      workspaceId: workspace_id,
      timestamp: new Date().toISOString(),
      data: data ?? {},
    });
    return text(result);
  },
);

server.tool(
  "llm_fire_budget_alert",
  "Manually trigger a budget alert webhook notification",
  {
    workspace_id: z.string().describe("Workspace ID"),
    event_type: z.enum(["budget_threshold", "budget_exceeded"]).describe("Alert type"),
    spend_usd: z.number().describe("Current spend in USD"),
    limit_usd: z.number().describe("Budget limit in USD"),
    threshold_pct: z.number().describe("Threshold percentage that triggered"),
    model_name: z.string().optional().describe("Model name if model-level budget"),
  },
  async ({ workspace_id, event_type, spend_usd, limit_usd, threshold_pct, model_name }) => {
    await notifyBudgetAlert(sql, {
      workspaceId: workspace_id,
      eventType: event_type as any,
      spendUsd: spend_usd,
      limitUsd: limit_usd,
      thresholdPct: threshold_pct,
      ...(model_name && { modelName: model_name }),
    });
    return text({ notified: true });
  },
);

