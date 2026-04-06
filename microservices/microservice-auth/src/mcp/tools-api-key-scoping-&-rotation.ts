// --- API key scoping & rotation ---

server.tool(
  "auth_check_scope",
  "Check if an API key has a specific scope permission",
  {
    key_id: z.string().describe("API key UUID"),
    required_scope: z.string().describe("Scope to check (e.g. memory:read, llm:chat)"),
  },
  async ({ key_id, required_scope }) => {
    const result = await getDetailedKeyInfo(sql, key_id);
    if (!result) return text({ has_permission: false, error: "Key not found" });
    const has = hasScopePermission(result.scopes as Scope[], required_scope as Scope);
    return text({ has_permission: has, scopes: result.scopes });
  },
);

server.tool(
  "auth_schedule_key_rotation",
  "Schedule automatic rotation for an API key",
  {
    key_id: z.string().describe("API key UUID"),
    frequency_days: z.number().int().positive().describe("Rotation frequency in days"),
  },
  async ({ key_id, frequency_days }) =>
    text(await scheduleRotation(sql, key_id, frequency_days)),
);

server.tool(
  "auth_get_key_rotation_schedule",
  "Get rotation schedule for an API key",
  { key_id: z.string().describe("API key UUID") },
  async ({ key_id }) => {
    const schedule = await getRotationSchedule(sql, key_id);
    return schedule ? text(schedule) : text({ error: "No rotation schedule set" });
  },
);

server.tool(
  "auth_get_keys_due_rotation",
  "Get all API keys that are due for rotation",
  {},
  async () => text(await getKeysDueForRotation(sql)),
);

server.tool(
  "auth_get_key_usage_stats",
  "Get usage statistics for an API key",
  { key_id: z.string().describe("API key UUID") },
  async ({ key_id }) => text(await getApiKeyUsageStats(sql, key_id)),
);

