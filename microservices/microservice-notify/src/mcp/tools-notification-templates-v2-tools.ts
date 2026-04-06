// --- Notification Templates v2 tools ---

server.tool(
  "notify_v2_create_template",
  "Create a new versioned notification template",
  {
    workspace_id: z.string(),
    name: z.string(),
    channel: ChannelSchema,
    subject: z.string().optional(),
    body: z.string(),
  },
  async ({ workspace_id, name, channel, subject, body }) => {
    const id = await createTemplateV2(sql, {
      workspaceId: workspace_id,
      name,
      channel,
      subject,
      body,
      active: true,
    });
    return text({ id });
  },
);

server.tool(
  "notify_v2_get_template",
  "Get a notification template by workspace, name, channel (optionally specific version)",
  {
    workspace_id: z.string(),
    name: z.string(),
    channel: ChannelSchema,
    version: z.number().int().positive().optional(),
  },
  async ({ workspace_id, name, channel, version }) => {
    const template = await getTemplateV2(sql, workspace_id, name, channel, version);
    return text({ template });
  },
);

server.tool(
  "notify_v2_list_templates",
  "List notification templates for a workspace",
  {
    workspace_id: z.string(),
    channel: ChannelSchema.optional(),
  },
  async ({ workspace_id, channel }) => {
    const templates = await listTemplatesV2(sql, workspace_id, channel);
    return text({ templates });
  },
);

server.tool(
  "notify_v2_render_template",
  "Render a notification template with variable substitution",
  {
    workspace_id: z.string(),
    name: z.string(),
    channel: ChannelSchema,
    variables: z.record(z.union([z.string(), z.number()])),
    version: z.number().int().positive().optional(),
  },
  async ({ workspace_id, name, channel, variables, version }) => {
    const template = await getTemplateV2(sql, workspace_id, name, channel, version);
    if (!template) return text({ error: "Template not found" });
    const rendered = await renderTemplateV2(template, variables as Record<string, string | number>);
    return text({ rendered });
  },
);

server.tool(
  "notify_v2_update_template",
  "Update a notification template (creates a new version)",
  {
    id: z.string(),
    subject: z.string().optional(),
    body: z.string().optional(),
  },
  async ({ id, subject, body }) => {
    await updateTemplateV2(sql, id, { subject, body });
    return text({ ok: true });
  },
);

server.tool(
  "notify_v2_get_template_analytics",
  "Get analytics for a notification template",
  {
    template_id: z.string(),
    start_date: z.string().optional().describe("ISO 8601 datetime"),
    end_date: z.string().optional().describe("ISO 8601 datetime"),
  },
  async ({ template_id, start_date, end_date }) => {
    const analytics = await getTemplateAnalytics(
      sql,
      parseInt(template_id, 10),
      start_date ? new Date(start_date) : undefined,
      end_date ? new Date(end_date) : undefined,
    );
    return text({ analytics });
  },
);

server.tool(
  "notify_v2_archive_template",
  "Archive (deactivate) a notification template",
  { id: z.string() },
  async ({ id }) => {
    await archiveTemplate(sql, parseInt(id, 10));
    return text({ ok: true });
  },
);

