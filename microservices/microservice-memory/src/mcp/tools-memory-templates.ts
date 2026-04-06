// --- Memory templates ---

server.tool(
  "memory_create_template",
  "Create a reusable memory template with {{variable}} placeholders",
  {
    workspace_id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    content_template: z.string(),
    variables: z.array(z.string()).optional(),
    default_memory_type: MemoryTypeEnum.optional(),
    default_priority: z.number().optional(),
  },
  async ({ workspace_id, name, description, content_template, variables, default_memory_type, default_priority }) =>
    text(await createMemoryTemplate(sql, {
      workspaceId: workspace_id,
      name,
      description,
      contentTemplate: content_template,
      variables,
      defaultMemoryType: default_memory_type,
      defaultPriority: default_priority,
    })),
);

server.tool(
  "memory_render_template",
  "Render a memory template by ID with variable substitutions",
  {
    template_id: z.string(),
    variables: z.record(z.string()),
  },
  async ({ template_id, variables }) => {
    const result = await renderMemoryTemplateById(sql, template_id, variables);
    return text(result ?? { error: "Template not found" });
  },
);

server.tool(
  "memory_list_templates",
  "List memory templates for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, user_id, limit }) =>
    text(await listMemoryTemplates(sql, workspace_id, { userId: user_id, limit })),
);

server.tool(
  "memory_update_template",
  "Update a memory template",
  {
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    content_template: z.string().optional(),
    variables: z.array(z.string()).optional(),
    default_memory_type: MemoryTypeEnum.optional(),
    default_priority: z.number().optional(),
  },
  async ({ id, ...updates }) => {
    const result = await updateMemoryTemplate(sql, id, {
      name: updates.name,
      description: updates.description,
      contentTemplate: updates.content_template,
      variables: updates.variables,
      defaultMemoryType: updates.default_memory_type,
      defaultPriority: updates.default_priority,
    });
    return text(result ?? { error: "Template not found" });
  },
);

server.tool(
  "memory_delete_template",
  "Delete a memory template",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteMemoryTemplate(sql, id) }),
);

server.tool(
  "memory_get_template",
  "Get a memory template by ID",
  { id: z.string() },
  async ({ id }) => {
    const template = await getMemoryTemplate(sql, id);
    return text(template ?? { error: "Template not found" });
  },
);

server.tool(
  "memory_render_template_string",
  "Render a template string by substituting {{variable}} placeholders (does not use DB)",
  {
    content_template: z.string().describe("Template string with {{variable}} placeholders"),
    variables: z.record(z.string()).describe("Key-value pairs to substitute"),
  },
  ({ content_template, variables }) => {
    const rendered = renderMemoryTemplate(content_template, variables);
    return text(rendered);
  },
);

