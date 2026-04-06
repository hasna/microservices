// --- Circuit breaker tools ---

server.tool(
  "llm_get_circuit_breaker",
  "Get the full circuit breaker object for a provider (state, config, stats)",
  { provider: z.string().describe("Provider name (openai, anthropic, groq)") },
  async ({ provider }) => {
    return text(await getCircuitBreaker(provider));
  },
);

