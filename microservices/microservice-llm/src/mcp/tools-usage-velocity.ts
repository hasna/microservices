// ─── Usage Velocity ───────────────────────────────────────────────────────────

server.tool(
  "llm_get_usage_velocity",
  "Get request and spend velocity over time windows (requests/min, spend/min) for a workspace. Useful for detecting traffic spikes and billing anomalies.",
  {
    workspace_id: z.string().describe("Workspace ID"),
    windows: z.array(z.number()).optional().default([1, 5, 15, 60]).describe("Time windows in minutes to compute velocity over"),
  },
  async ({ workspace_id, windows }) => {
    const { getWorkspaceUsage } = await import("../lib/usage.js");
    const now = Date.now();
    const results: Record<string, { requests_per_min: number; cost_per_min: number; total_requests: number; total_cost: number }> = {};
    for (const windowMin of windows.slice(0, 6)) {
      const since = new Date(now - windowMin * 60 * 1000);
      const usage = await getWorkspaceUsage(sql, workspace_id, since);
      const divisor = windowMin || 1;
      results[`${windowMin}m`] = {
        requests_per_min: Math.round((usage.total_requests / divisor) * 100) / 100,
        cost_per_min: Math.round((usage.total_cost_usd / divisor) * 10000) / 10000,
        total_requests: usage.total_requests,
        total_cost: Math.round(usage.total_cost_usd * 1000000) / 1000000,
      };
    }
    return text({ workspace_id, velocities: results });
  },
);

