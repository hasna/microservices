// --- Template versioning: diff ---
server.tool(
  "notify_get_template_version_diff",
  "Compare two versions of a template and return the diff",
  {
    template_id: z.string(),
    from_version: z.number(),
    to_version: z.number(),
  },
  async ({ template_id, from_version, to_version }) => {
    const result = await getTemplateVersionDiff(sql, template_id, from_version, to_version);
    if (!result) return text({ error: "One or both versions not found" });
    return text(result);
  },
);

