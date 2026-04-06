// --- Brute Force Analytics tools ---

server.tool(
  "auth_get_brute_force_stats",
  "Get brute force attack statistics for a time window",
  {
    workspace_id: z.string().optional(),
    hours: z.number().optional().default(24),
  },
  async ({ workspace_id, hours }) => {
    const { getBruteForceStats } = await import("../lib/brute-force-analytics.js");
    return text(await getBruteForceStats(sql, workspace_id, hours));
  },
);

server.tool(
  "auth_detect_brute_force_campaigns",
  "Detect coordinated brute force campaigns targeting the same accounts from multiple IPs",
  {
    workspace_id: z.string().optional(),
    hours: z.number().optional().default(24),
  },
  async ({ workspace_id, hours }) => {
    const { detectBruteForceCampaigns } = await import("../lib/brute-force-analytics.js");
    return text(await detectBruteForceCampaigns(sql, workspace_id, hours));
  },
);

server.tool(
  "auth_get_most_targeted_accounts",
  "Get accounts most targeted by brute force attacks",
  {
    workspace_id: z.string().optional(),
    hours: z.number().optional().default(24),
    limit: z.number().optional().default(10),
  },
  async ({ workspace_id, hours, limit }) => {
    const { getMostTargetedAccounts } = await import("../lib/brute-force-analytics.js");
    return text(await getMostTargetedAccounts(sql, workspace_id, hours, limit));
  },
);

server.tool(
  "auth_get_ip_brute_force_stats",
  "Get brute force statistics for a specific IP address",
  {
    ip: z.string(),
    hours: z.number().optional().default(24),
  },
  async ({ ip, hours }) => {
    const { getIpBruteForceStats } = await import("../lib/brute-force-analytics.js");
    return text(await getIpBruteForceStats(sql, ip, hours));
  },
);

