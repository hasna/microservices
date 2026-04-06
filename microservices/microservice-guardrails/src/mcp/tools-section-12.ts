// ─── Batch DSL Rule Evaluation ───────────────────────────────────────────────

server.tool(
  "guardrails_evaluate_dsl_batch",
  "Evaluate DSL rules against multiple texts in a single batch call — returns per-text results",
  {
    texts: z.array(z.string()).describe("Array of texts to evaluate (max 50)"),
    rule_patterns: z.array(z.object({
      name: z.string(),
      pattern: z.string(),
      action: z.enum(["block", "redact", "warn", "log"]).optional().default("log"),
    })).describe("DSL rules to evaluate each text against"),
    stop_on_first: z.boolean().optional().default(false).describe("Stop at first match per text"),
  },
  async ({ texts, rule_patterns, stop_on_first }) => {
    const { evaluateDSLRule, validateDSLPattern } = await import("../lib/dsl-rules.js");
    const results = [];
    for (const text of texts.slice(0, 50)) {
      const textResults = [];
      for (const rule of rule_patterns) {
        const validation = validateDSLPattern(rule.pattern);
        if (!validation.valid) {
          textResults.push({ rule: rule.name, valid: false, error: validation.error });
          continue;
        }
        const result = await evaluateDSLRule({ name: rule.name, pattern: rule.pattern, action: rule.action ?? "log" }, text);
        textResults.push({ rule: rule.name, ...result });
        if (stop_on_first && result.matched) break;
      }
      results.push({ text_length: text.length, matches: textResults });
    }
    return text({ texts_evaluated: texts.length, results });
  },
);

