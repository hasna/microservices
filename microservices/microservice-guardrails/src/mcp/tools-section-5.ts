// ─── Streaming Guard ─────────────────────────────────────────────────────────

server.tool(
  "guardrails_check_input_stream",
  "Check input text stream for guard violations (PII, toxicity, policy) as a stream",
  {
    text: z.string().describe("Input text to check"),
    workspace_id: z.string().optional().describe("Optional workspace ID"),
  },
  async ({ text: inputText, workspace_id }) =>
    text(await checkInputStream(sql, inputText, workspace_id)),
);

server.tool(
  "guardrails_check_output_stream",
  "Check output text stream for guard violations as a stream",
  {
    text: z.string().describe("Output text to check"),
    workspace_id: z.string().optional().describe("Optional workspace ID"),
  },
  async ({ text: inputText, workspace_id }) =>
    text(await checkOutputStream(sql, inputText, workspace_id)),
);

