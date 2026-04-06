// ─── Workspace Rule Batch Operations ─────────────────────────────────────────

server.tool(
  "guardrails_batch_toggle_rules",
  "Enable or disable multiple guard rules in one call",
  {
    rule_ids: z.array(z.string()).describe("Array of rule IDs to toggle"),
    enabled: z.boolean().describe("Target enabled state"),
  },
  async ({ rule_ids, enabled }) => {
    const { toggleGuardRule } = await import("../lib/dsl-rules.js");
    const results = await Promise.all(rule_ids.map(async (id) => {
      try { return { id, success: await toggleGuardRule(sql, id, enabled) }; }
      catch (e) { return { id, success: false, error: String(e) }; }
    }));
    return text({ toggled: results.length, results });
  },
);

server.tool(
  "guardrails_batch_delete_rules",
  "Delete multiple guard rules in one call (returns IDs that were deleted)",
  {
    rule_ids: z.array(z.string()).describe("Array of rule IDs to delete"),
  },
  async ({ rule_ids }) => {
    const { deleteGuardRule } = await import("../lib/dsl-rules.js");
    const results = await Promise.all(rule_ids.map(async (id) => {
      try { await deleteGuardRule(sql, id); return { id, deleted: true }; }
      catch (e) { return { id, deleted: false, error: String(e) }; }
    }));
    return text({ deleted: results.filter(r => r.deleted).length, results });
  },
);

