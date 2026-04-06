// --- Function calling tools ---

server.tool(
  "llm_parse_tool_calls",
  "Parse a model response into structured tool calls",
  {
    model_output: z.string().describe("Raw model output text to parse"),
    tools: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.any()),
    })).describe("Tool definitions to match against"),
  },
  async ({ model_output, tools }) => {
    const calls = parseToolCalls(model_output, tools as any);
    return text({ tool_calls: calls, count: calls.length });
  },
);

server.tool(
  "llm_build_openai_tools",
  "Convert tool definitions to OpenAI function-calling format",
  {
    tools: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.any()),
    })).describe("Tool definitions"),
  },
  async ({ tools }) => {
    const openaiTools = buildOpenAITools(tools as any);
    return text({ tools: openaiTools, count: openaiTools.length });
  },
);

server.tool(
  "llm_execute_tool_call",
  "Execute a single tool call by invoking the registered function",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    tool_name: z.string().describe("Name of the tool to execute"),
    arguments: z.record(z.any()).describe("Tool arguments as key-value pairs"),
  },
  async ({ workspace_id, tool_name, arguments: args }) => {
    const result = await executeToolCall(sql, workspace_id, tool_name, args);
    return text(result);
  },
);

