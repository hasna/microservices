// ─── Namespace Analytics ───────────────────────────────────────────────────────

server.tool(
  "memory_get_namespace_analytics",
  "Get detailed analytics for a namespace — memory count, type breakdown, importance histogram, access patterns",
  {
    workspace_id: z.string(),
    namespace: z.string().describe("Namespace name"),
    period_hours: z.number().optional().default(720).describe("Look back window in hours (default 30 days)"),
  },
  async ({ workspace_id, namespace, period_hours }) => {
    const { getNamespaceAnalytics } = await import("../lib/memory-namespaces.js");
    return text(await getNamespaceAnalytics(sql, workspace_id, namespace, period_hours));
  },
);

