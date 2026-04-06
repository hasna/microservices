// ─── Fallback Chain Simulation ───────────────────────────────────────────────

server.tool(
  "llm_simulate_cascade",
  "Simulate a fallback chain cascade — test how a chain behaves when specific providers fail. Returns which step would be called and what error would occur at each stage.",
  {
    workspace_id: z.string().describe("Workspace ID"),
    messages: z.array(z.object({ role: z.string(), content: z.string() })).describe("Chat messages"),
    chain: z.array(z.object({ provider: z.string(), model: z.string() })).describe("Fallback chain steps"),
    fail_at_step: z.number().optional().describe("Simulate failure at this step index (1-based)"),
  },
  async ({ workspace_id, messages, chain, fail_at_step }) => {
    const { callWithFallback } = await import("../lib/providers.js");
    const steps: string[] = [];
    const errors: string[] = [];
    let reachedStep = 0;
    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      if (fail_at_step && i + 1 >= fail_at_step) {
        errors.push(`Step ${i + 1}: Simulated failure for ${step.provider}/${step.model}`);
        steps.push(`${step.provider}/${step.model} → FAILED`);
        continue;
      }
      try {
        const result = await callWithFallback(sql, workspace_id, messages, step.model);
        steps.push(`${step.provider}/${step.model} → SUCCESS`);
        reachedStep = i + 1;
        break;
      } catch (e) {
        errors.push(`Step ${i + 1}: ${step.provider}/${step.model} → ${String(e)}`);
        steps.push(`${step.provider}/${step.model} → ERROR: ${String(e).slice(0, 100)}`);
      }
    }
    return text({
      cascade: steps,
      would_reach_step: reachedStep,
      total_steps: chain.length,
      simulation: { fail_at_step, errors },
    });
  },
);

