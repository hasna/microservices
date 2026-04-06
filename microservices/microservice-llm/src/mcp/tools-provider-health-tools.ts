// --- Provider health tools ---

server.tool(
  "llm_get_provider_health",
  "Get health metrics for a specific provider (latency, error rate, uptime)",
  {
    provider: z.string().describe("Provider name"),
    period_hours: z.number().optional().default(24).describe("Time window in hours"),
  },
  async ({ provider, period_hours }) =>
    text(await getProviderHealth(sql, { provider, periodHours: period_hours })),
);

server.tool(
  "llm_list_provider_health",
  "Get health metrics for all providers",
  { period_hours: z.number().optional().default(24).describe("Time window in hours") },
  async ({ period_hours }) => text(await listProviderHealth(sql, { periodHours: period_hours })),
);

server.tool(
  "llm_get_circuit_status",
  "Get circuit breaker state for a provider",
  { provider: z.string().describe("Provider name") },
  async ({ provider }) => text(await getProviderCircuitStatus(sql, provider)),
);

server.tool(
  "llm_list_circuit_states",
  "Get circuit breaker state for all providers",
  {},
  async () => text(await getAllCircuitStates(sql)),
);

server.tool(
  "llm_reset_circuit",
  "Reset (force close) a provider's circuit breaker",
  { provider: z.string().describe("Provider name") },
  async ({ provider }) => {
    await resetProviderCircuit(sql, provider);
    return text({ provider, state: "closed" });
  },
);

