// ─── Adaptive Guard ──────────────────────────────────────────────────────────

server.tool(
  "guardrails_apply_adaptive_strictness",
  "Apply adaptive strictness level adjustment to the guard system",
  {
    workspace_id: z.string().describe("Workspace ID"),
    level: z.enum(["relaxed", "normal", "strict", "paranoid"]),
  },
  async ({ workspace_id, level }) =>
    text(await applyAdaptiveStrictness(sql, workspace_id, level)),
);

