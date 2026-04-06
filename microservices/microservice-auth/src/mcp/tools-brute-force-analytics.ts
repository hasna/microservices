// --- Brute force analytics ---

server.tool(
  "auth_get_brute_force_stats",
  "Get brute force attack statistics for a time window",
  {
    workspace_id: z.string().optional().describe("Filter by workspace UUID"),
    hours: z.number().int().positive().optional().default(24).describe("Time window in hours"),
  },
  async ({ workspace_id, hours }) => text(await getBruteForceStats(sql, workspace_id, hours)),
);

server.tool(
  "auth_detect_brute_force_campaigns",
  "Detect coordinated brute force attack campaigns by IP patterns",
  {
    workspace_id: z.string().optional().describe("Filter by workspace UUID"),
    min_attempts: z.number().int().positive().optional().default(5),
  },
  async ({ workspace_id, min_attempts }) =>
    text(await detectBruteForceCampaigns(sql, workspace_id, min_attempts)),
);

server.tool(
  "auth_get_ip_brute_force_stats",
  "Get brute force statistics for a specific IP address",
  {
    ip_address: z.string().describe("IP address to analyze"),
    hours: z.number().int().positive().optional().default(24),
  },
  async ({ ip_address, hours }) =>
    text(await getIpBruteForceStats(sql, ip_address, hours)),
);

server.tool(
  "auth_get_most_targeted_accounts",
  "Get accounts most frequently targeted by brute force attacks",
  {
    workspace_id: z.string().optional().describe("Filter by workspace UUID"),
    limit: z.number().int().positive().optional().default(10),
  },
  async ({ workspace_id, limit }) =>
    text(await getMostTargetedAccounts(sql, workspace_id, limit)),
);

