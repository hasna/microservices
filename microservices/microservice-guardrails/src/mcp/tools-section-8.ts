// ─── Batch DSL Rule Evaluation ─────────────────────────────────────────────────

server.tool(
  "guardrails_evaluate_guard_rules",
  "Evaluate multiple DSL guard rules against input text in one call — returns all matches",
  {
    workspace_id: z.string().uuid().describe("Workspace ID"),
    text: z.string().describe("Input text to evaluate against all enabled rules"),
    rule_ids: z.array(z.string().uuid()).optional().describe("Specific rule IDs to evaluate; omit to use all enabled rules"),
    stop_on_first: z.boolean().optional().default(false).describe("Stop after first match (for efficiency)"),
  },
  async ({ workspace_id, text, rule_ids, stop_on_first }) => {
    const { evaluateGuardRules } = await import("../lib/dsl-rules.js");
    return text(await evaluateGuardRules(sql, workspace_id, text, rule_ids, stop_on_first));
  },
);

