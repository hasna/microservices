// --- Gap: templates.ts direct access ---

server.tool(
  "notify_get_template",
  "Get a notification template by ID (basic templates table)",
  { id: z.string() },
  async ({ id }) => text(await getTemplate(sql, id)),
);

server.tool(
  "notify_get_template_by_name",
  "Get a notification template by name (basic templates table)",
  { name: z.string() },
  async ({ name }) => text(await getTemplateByName(sql, name)),
);

server.tool(
  "notify_update_template",
  "Update a notification template (basic templates table)",
  {
    id: z.string(),
    name: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    channel: z.string().optional(),
    variables: z.array(z.string()).optional(),
  },
  async ({ id, name, subject, body, channel, variables }) =>
    text(await updateTemplate(sql, id, { name, subject, body, channel, variables })),
);

server.tool(
  "notify_render_template_string",
  "Render a template string by substituting {{variable}} placeholders",
  {
    template: z.string(),
    variables: z.record(z.string()),
  },
  async ({ template, variables }) => text({ rendered: renderTemplate(template, variables) }),
);

