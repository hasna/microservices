// ─── Auth Timeout Policies ────────────────────────────────────────────────────

server.tool(
  "auth_upsert_timeout_policy",
  "Set or update a session timeout policy (workspace-level or user-level)",
  {
    workspace_id: z.string().optional().describe("Workspace ID (omit for user-level)"),
    user_id: z.string().optional().describe("User ID (omit for workspace-level)"),
    session_max_age_seconds: z.number().int().positive().optional().default(86400),
    session_idle_timeout_seconds: z.number().int().positive().optional().default(3600),
    require_reauth_on_inactive_seconds: z.number().int().positive().optional(),
    enabled: z.boolean().optional().default(true),
  },
  async (opts) =>
    text(await upsertTimeoutPolicy(sql, {
      workspaceId: opts.workspace_id,
      userId: opts.user_id,
      sessionMaxAgeSeconds: opts.session_max_age_seconds,
      sessionIdleTimeoutSeconds: opts.session_idle_timeout_seconds,
      requireReauthOnInactiveSeconds: opts.require_reauth_on_inactive_seconds,
      enabled: opts.enabled,
    })),
);

server.tool(
  "auth_get_effective_timeout",
  "Get the effective session timeout for a user (user > workspace > global)",
  {
    user_id: z.string().describe("User ID"),
    workspace_id: z.string().optional().describe("Workspace ID"),
  },
  async ({ user_id, workspace_id }) =>
    text(await getEffectiveTimeout(sql, user_id, workspace_id)),
);

server.tool(
  "auth_is_session_idle_expired",
  "Check whether a session has exceeded its idle timeout",
  {
    session_id: z.string().describe("Session ID"),
    user_id: z.string().describe("User ID"),
    workspace_id: z.string().optional(),
  },
  async ({ session_id, user_id, workspace_id }) =>
    text(await isSessionIdleExpired(sql, session_id, user_id, workspace_id)),
);

server.tool(
  "auth_list_timeout_policies",
  "List all timeout policies for a workspace (user-level and workspace-level)",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await listWorkspaceTimeoutPolicies(sql, workspace_id)),
);

