// --- Direct provider chat tools ---

server.tool(
  "llm_chat_anthropic",
  "Send a chat request directly to Anthropic API",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model (e.g. claude-3-5-sonnet-20241022)"),
    max_tokens: z.number().optional().describe("Max tokens to generate"),
    temperature: z.number().optional().describe("Sampling temperature"),
    api_key: z.string().optional().describe("Override ANTHROPIC_API_KEY"),
  },
  async ({ workspace_id, messages, model, max_tokens, temperature, api_key }) => {
    const result = await chatAnthropic({
      workspaceId: workspace_id,
      messages: messages as any,
      model,
      maxTokens: max_tokens,
      temperature,
      apiKey: api_key,
    });
    return text(result);
  },
);

server.tool(
  "llm_chat_openai",
  "Send a chat request directly to OpenAI API",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model (e.g. gpt-4o)"),
    max_tokens: z.number().optional().describe("Max tokens to generate"),
    temperature: z.number().optional().describe("Sampling temperature"),
    api_key: z.string().optional().describe("Override OPENAI_API_KEY"),
  },
  async ({ workspace_id, messages, model, max_tokens, temperature, api_key }) => {
    const result = await chatOpenAI({
      workspaceId: workspace_id,
      messages: messages as any,
      model,
      maxTokens: max_tokens,
      temperature,
      apiKey: api_key,
    });
    return text(result);
  },
);

server.tool(
  "llm_chat_groq",
  "Send a chat request directly to Groq API",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model (e.g. llama-3.1-70b-versatile)"),
    temperature: z.number().optional().describe("Sampling temperature"),
    api_key: z.string().optional().describe("Override GROQ_API_KEY"),
  },
  async ({ workspace_id, messages, model, temperature, api_key }) => {
    const result = await chatGroq({
      workspaceId: workspace_id,
      messages: messages as any,
      model,
      temperature,
      apiKey: api_key,
    });
    return text(result);
  },
);

server.tool(
  "llm_complete_openai",
  "Send a text completion request directly to OpenAI API",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    prompt: z.string().describe("Text prompt"),
    model: z.string().optional().describe("Model (e.g. gpt-4o-mini)"),
    max_tokens: z.number().optional().describe("Max tokens to generate"),
    temperature: z.number().optional().describe("Sampling temperature"),
    api_key: z.string().optional().describe("Override OPENAI_API_KEY"),
  },
  async ({ workspace_id, prompt, model, max_tokens, temperature, api_key }) => {
    const result = await completeOpenAI({
      workspaceId: workspace_id,
      prompt,
      model,
      maxTokens: max_tokens,
      temperature,
      apiKey: api_key,
    });
    return text(result);
  },
);

