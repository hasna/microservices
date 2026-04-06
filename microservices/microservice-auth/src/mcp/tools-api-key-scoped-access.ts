// ─── API Key Scoped Access ────────────────────────────────────────────────────

server.tool(
  "auth_can_access_resource",
  "Check if an API key can perform a specific action on a resource (based on its scopes)",
  {
    key_id: z.string().describe("API key ID"),
    resource: z.string().describe("Resource name (e.g. 'memory', 'llm', 'sessions')"),
    action: z.enum(["create", "read", "update", "delete"]).describe("Action to check"),
  },
  async ({ key_id, resource, action }) => {
    const { hasScopePermission, getDetailedKeyInfo } = await import("../lib/api-key-scopes.js");
    const keyInfo = await getDetailedKeyInfo(sql, key_id);
    if (!keyInfo) return text({ allowed: false, reason: "Key not found" });
    const allowed = hasScopePermission(keyInfo.scopes as any, `${resource}:${action}` as any) ||
                    hasScopePermission(keyInfo.scopes as any, "admin" as any);
    return text({ allowed, scopes: keyInfo.scopes });
  },
);

server.tool(
  "auth_get_api_key_usage_stats",
  "Get usage statistics for an API key — request counts, daily breakdown, endpoint hit counts",
  {
    key_id: z.string().describe("API key ID"),
    since: z.string().optional().describe("ISO date — start of window (default 7 days ago)"),
  },
  async ({ key_id, since }) => {
    const { getApiKeyUsageStats } = await import("../lib/api-key-scopes.js");
    const sinceDate = since ? new Date(since) : undefined;
    return text(await getApiKeyUsageStats(sql, key_id, sinceDate));
  },
);

server.tool(
  "auth_log_api_key_usage",
  "Log an API key usage event for an endpoint call — enables per-key audit trail and rate limit tracking",
  {
    key_id: z.string().describe("API key ID"),
    endpoint: z.string().describe("API endpoint called"),
    method: z.string().describe("HTTP method"),
    status_code: z.number().int().describe("HTTP status code returned"),
    response_time_ms: z.number().int().optional().default(0),
  },
  async ({ key_id, endpoint, method, status_code, response_time_ms }) => {
    const { logApiKeyUsage } = await import("../lib/api-key-scopes.js");
    await logApiKeyUsage(sql, key_id, endpoint, method, status_code, response_time_ms);
    return text({ logged: true });
  },
);

