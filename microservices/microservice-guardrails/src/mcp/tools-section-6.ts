// ─── Client Rate Limiting ────────────────────────────────────────────────────

server.tool(
  "guardrails_identify_client",
  "Identify a client by IP address, API key, and/or user agent — returns a stable client ID",
  {
    ip_address: z.string().optional(),
    api_key: z.string().optional(),
    user_agent: z.string().optional(),
  },
  async ({ ip_address, api_key, user_agent }) =>
    text({ client_id: identifyClient(ip_address, api_key, user_agent) }),
);

server.tool(
  "guardrails_list_client_rate_limits",
  "List all per-client rate limit configurations for a workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await listClientRateLimitStatuses(sql, workspace_id)),
);

server.tool(
  "guardrails_clear_client_block",
  "Clear a block for a specific client ID in a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    client_id: z.string().describe("Client ID to unblock"),
  },
  async ({ workspace_id, client_id }) =>
    text({ cleared: await clearClientBlock(sql, workspace_id, client_id) }),
);

