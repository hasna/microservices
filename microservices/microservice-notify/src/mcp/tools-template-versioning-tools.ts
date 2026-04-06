// --- Template Versioning tools ---

server.tool(
  "notify_list_template_versions",
  "List all versions of a notification template (newest first)",
  { template_id: z.string().describe("Template ID to get version history for") },
  async ({ template_id }) => text(await listTemplateVersions(sql, template_id)),
);

server.tool(
  "notify_create_template_version",
  "Manually create a version snapshot of a notification template (useful before making changes)",
  {
    template_id: z.string().describe("Template ID to snapshot"),
    changed_by: z.string().optional().describe("User creating the snapshot"),
    change_reason: z.string().optional().describe("Reason for snapshot (e.g. 'before major update')"),
  },
  async ({ template_id, changed_by, change_reason }) => {
    // First get the current template to snapshot its content
    const current = await getTemplate(sql, template_id);
    if (!current) return text({ error: "Template not found" });
    return text(await createTemplateVersion(sql, {
      template_id,
      name: current.name,
      subject_template: current.subject ?? null,
      body_template: current.body,
      channel_type: current.channel ?? null,
      variables: current.variables ?? [],
      changed_by: changed_by ?? null,
      change_reason: change_reason ?? null,
    }));
  },
);

server.tool(
  "notify_get_template_version",
  "Get a specific version of a notification template by version number",
  {
    template_id: z.string().describe("Template ID"),
    version_number: z.number().int().positive().describe("Version number to retrieve"),
  },
  async ({ template_id, version_number }) =>
    text(await getTemplateVersion(sql, template_id, version_number)),
);

server.tool(
  "notify_rollback_template",
  "Rollback a notification template to a previous version",
  {
    template_id: z.string().describe("Template ID to rollback"),
    target_version: z.number().int().positive().describe("Version number to rollback to"),
    changed_by: z.string().optional().describe("User performing the rollback"),
    reason: z.string().optional().describe("Reason for rollback"),
  },
  async ({ template_id, target_version, changed_by, reason }) =>
    text(await rollbackTemplate(sql, template_id, target_version, changed_by, reason)),
);

server.tool(
  "notify_get_template_diff",
  "Compare two versions of a template to see what changed",
  {
    template_id: z.string().describe("Template ID"),
    from_version: z.number().int().positive().describe("Older version number"),
    to_version: z.number().int().positive().describe("Newer version number"),
  },
  async ({ template_id, from_version, to_version }) =>
    text(await getTemplateVersionDiff(sql, template_id, from_version, to_version)),
);

