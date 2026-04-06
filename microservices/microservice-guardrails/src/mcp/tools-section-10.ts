// ─── Get Workspace Quota Config ─────────────────────────────────────────────────

server.tool(
  "guardrails_get_workspace_quota",
  "Get the current quota configuration for a workspace (daily or monthly limits)",
  {
    workspace_id: z.string().uuid().describe("Workspace ID"),
  },
  async ({ workspace_id }) => {
    const { getWorkspaceQuotaUsage } = await import("../lib/workspace-quotas.js");
    return text(await getWorkspaceQuotaUsage(sql, workspace_id, undefined));
  },
);

