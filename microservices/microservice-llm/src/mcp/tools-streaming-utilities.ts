// --- Streaming utilities ---

server.tool(
  "llm_parse_sse_line",
  "Parse a single SSE-formatted line into event data",
  {
    line: z.string().describe("One line from an SSE stream (format: 'data: {...}')"),
  },
  async ({ line }) => {
    const event = parseSSELine(line);
    return text(event ?? { parsed: false });
  },
);

server.tool(
  "llm_parse_sse_body",
  "Parse a complete SSE body string into structured events",
  {
    body: z.string().describe("Full SSE response body text"),
  },
  async ({ body }) => {
    const events = parseSSEBody(body);
    return text({ events, count: events.length });
  },
);

server.tool(
  "llm_sse_encode",
  "Encode a data object as an SSE-formatted string",
  {
    event: z.string().optional().describe("Event name (e.g. 'chunk', 'done')"),
    data: z.union([z.string(), z.record(z.any())]).describe("Data to encode"),
    id: z.string().optional().describe("Optional event ID"),
  },
  async ({ event, data, id }) => {
    const encoded = sseEncode(event ?? "", data, id);
    return text({ encoded });
  },
);

server.tool(
  "llm_stream_to_text",
  "Convert a streaming response into full text by collecting all chunks",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model to use"),
  },
  async ({ workspace_id, messages, model }) => {
    const { chatStream } = await import("../lib/gateway.js");
    const stream = chatStream(sql, {
      workspaceId: workspace_id,
      messages: messages as Message[],
      model: model ?? undefined,
    });
    const fullText = await streamToText(stream);
    return text({ content: fullText });
  },
);

server.tool(
  "llm_stream_to_sse",
  "Convert a chat stream into SSE (Server-Sent Events) format — yields data chunks as SSE events",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model to use"),
    provider: z.enum(["openai", "anthropic", "groq"]).optional().describe("Provider to use"),
  },
  async ({ workspace_id, messages, model, provider }) => {
    const { chatStream } = await import("../lib/gateway.js");
    const stream = chatStream(sql, {
      workspaceId: workspace_id,
      messages: messages as Message[],
      model: model ?? undefined,
    });
    const sseStream = streamToSSE(stream as any, { model, provider });
    // Collect SSE stream into an array of strings for the response
    const reader = sseStream.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      chunks.push(text);
    }
    return text({ sse_chunks: chunks.join("") });
  },
);

