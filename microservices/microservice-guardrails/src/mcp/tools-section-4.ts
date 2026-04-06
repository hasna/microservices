// ─── DSL Rule Evaluation ─────────────────────────────────────────────────────

server.tool(
  "guardrails_evaluate_dsl_rule",
  "Evaluate a DSL guard rule pattern against text without storing it",
  {
    pattern: z.string().describe("DSL pattern expression (e.g. contains(pii.email))"),
    text: z.string().describe("Text to evaluate against the pattern"),
    rule_name: z.string().optional().describe("Optional rule name for reporting"),
    action: z.enum(["block", "redact", "warn", "log"]).optional().default("log"),
  },
  async ({ pattern, text, rule_name, action }) => {
    const validation = validateDSLPattern(pattern);
    if (!validation.valid) {
      return text({ valid: false, error: validation.error });
    }
    return text(await evaluateDSLRule({ name: rule_name ?? "inline", pattern, action: action ?? "log" }, text));
  },
);

server.tool(
  "guardrails_validate_dsl_pattern",
  "Validate a DSL pattern without executing it — checks syntax, balanced parens, known functions",
  { pattern: z.string().describe("DSL pattern to validate") },
  async ({ pattern }) => text(validateDSLPattern(pattern)),
);

