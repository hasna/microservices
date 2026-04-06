// ─── Notification Templates ──────────────────────────────────────────────────

server.tool(
  "notify_create_template",
  "Create a reusable notification template with variable placeholders",
  {
    workspace_id: z.string(),
    name: z.string().describe("Template name (unique per workspace)"),
    subject: z.string().optional().describe("Email subject template"),
    body: z.string().describe("Body template with {{variable}} placeholders"),
    channel: z.enum(["email", "sms", "push", "webhook"]).optional().default("email"),
    description: z.string().optional(),
  },
  async ({ workspace_id, name, subject, body, channel, description }) => {
    const { createTemplate } = await import("../lib/templates.js");
    return text(await createTemplate(sql, { workspaceId: workspace_id, name, subject, body, channel, description }));
  },
);

server.tool(
  "notify_render_template",
  "Render a notification template with provided variable values",
  {
    template_id: z.string(),
    variables: z.record(z.string()).describe("Key-value pairs for template variables"),
  },
  async ({ template_id, variables }) => {
    const { renderTemplate } = await import("../lib/templates.js");
    return text(await renderTemplate(sql, template_id, variables));
  },
);

server.tool(
  "notify_render_template_by_name",
  "Render a template by workspace and name without needing template ID",
  {
    workspace_id: z.string(),
    name: z.string(),
    variables: z.record(z.string()),
  },
  async ({ workspace_id, name, variables }) => {
    const { getTemplateByName, renderTemplate } = await import("../lib/templates.js");
    const template = await getTemplateByName(sql, workspace_id, name);
    if (!template) return text({ error: "Template not found" });
    return text(await renderTemplate(sql, template.id, variables));
  },
);

server.tool(
  "notify_list_templates",
  "List all notification templates for a workspace",
  {
    workspace_id: z.string(),
    channel: z.enum(["email", "sms", "push", "webhook"]).optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, channel, limit }) => {
    const { listTemplates } = await import("../lib/templates.js");
    return text(await listTemplates(sql, workspace_id, channel, limit));
  },
);

server.tool(
  "notify_delete_template",
  "Delete a notification template by ID",
  { template_id: z.string() },
  async ({ template_id }) => {
    const { deleteTemplate } = await import("../lib/templates.js");
    return text({ deleted: await deleteTemplate(sql, template_id) });
  },
);

