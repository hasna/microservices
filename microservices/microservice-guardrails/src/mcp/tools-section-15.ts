// ─── DSL Rule Import/Export ───────────────────────────────────────────────────

server.tool(
  "guardrails_export_rules_json",
  "Export all guard rules for a workspace as JSON (for backup/migration)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    include_disabled: z.boolean().optional().default(false).describe("Include disabled rules"),
  },
  async ({ workspace_id, include_disabled }) => {
    const { listGuardRules } = await import("../lib/dsl-rules.js");
    const rules = await listGuardRules(sql, { workspaceId: workspace_id });
    const filtered = include_disabled ? rules : rules.filter(r => r.enabled);
    return text({ rules: filtered, count: filtered.length });
  },
);

