// ─── Audit Export JSON ───────────────────────────────────────────────────────

server.tool(
  "auth_export_audit_json",
  "Export audit log as formatted JSON for compliance reporting",
  {
    user_id: z.string().optional(),
    event_type: z.string().optional().describe("Filter by event type"),
    since: z.string().optional().describe("ISO timestamp — start of window"),
    limit: z.number().optional().default(1000),
  },
  async ({ user_id, event_type, since, limit }) => {
    const { exportAuditLog } = await import("../lib/audit-log.js");
    return text({ export: await exportAuditLog(sql, { userId: user_id, eventType: event_type as any, since: since ? new Date(since) : undefined, format: "json", limit }) });
  },
);

