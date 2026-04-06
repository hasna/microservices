// ─── Archival Policies ────────────────────────────────────────────────────────

server.tool(
  "memory_create_archival_policy",
  "Create an archival policy — defines when memories auto-archive based on age/type/access",
  {
    workspace_id: z.string(),
    name: z.string(),
    conditions: z.object({
      max_age_days: z.number().int().positive().optional(),
      memory_types: z.array(MemoryTypeEnum).optional(),
      min_access_count: z.number().int().nonnegative().optional(),
      namespaces: z.array(z.string()).optional(),
    }),
    action: z.enum(["archive", "delete", "downgrade_type"]).default("archive"),
    enabled: z.boolean().optional().default(true),
  },
  async ({ workspace_id, name, conditions, action, enabled }) => {
    const { createArchivalPolicy } = await import("../lib/index.js");
    return text(await createArchivalPolicy(sql, { workspaceId: workspace_id, name, conditions, action, enabled }));
  },
);

server.tool(
  "memory_list_archival_policies",
  "List all archival policies for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const { listArchivalPolicies } = await import("../lib/index.js");
    return text(await listArchivalPolicies(sql, workspace_id));
  },
);

server.tool(
  "memory_execute_archival_policies",
  "Execute all enabled archival policies for a workspace (dry_run returns count without deleting)",
  {
    workspace_id: z.string(),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ workspace_id, dry_run }) => {
    const { executeArchivalPolicies } = await import("../lib/index.js");
    return text(await executeArchivalPolicies(sql, workspace_id, dry_run));
  },
);

