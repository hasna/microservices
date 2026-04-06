// ─── Permission Delegation ───────────────────────────────────────────────────

server.tool(
  "auth_create_delegation",
  "Grant another user temporary permission to act on your behalf",
  {
    grantor_id: z.string().describe("User ID granting the delegation"),
    grantee_id: z.string().describe("User ID receiving the delegated permissions"),
    scopes: z.array(z.string()).describe("Scopes to delegate (e.g. ['memory:read', 'llm:chat'])"),
    reason: z.string().optional().describe("Reason for delegation"),
    ttl_hours: z.number().int().positive().optional().default(24),
  },
  async ({ grantor_id, grantee_id, scopes, reason, ttl_hours }) =>
    text(await createDelegation(sql, grantor_id, grantee_id, scopes, { reason, ttlHours: ttl_hours })),
);

server.tool(
  "auth_revoke_delegation",
  "Revoke a permission delegation before it expires",
  {
    delegation_id: z.string().describe("Delegation ID to revoke"),
    grantor_id: z.string().describe("User ID who originally granted the delegation"),
  },
  async ({ delegation_id, grantor_id }) =>
    text({ revoked: await revokeDelegation(sql, delegation_id, grantor_id) }),
);

server.tool(
  "auth_get_active_delegations",
  "Get all active delegations for a user (as grantee or grantor)",
  {
    user_id: z.string().describe("User ID"),
    role: z.enum(["grantee", "grantor"]).optional().default("grantee"),
  },
  async ({ user_id, role }) =>
    text(role === "grantor"
      ? await getActiveDelegationsForGrantor(sql, user_id)
      : await getActiveDelegationsForGrantee(sql, user_id)),
);

server.tool(
  "auth_check_delegated_scope",
  "Check if a user has a specific delegated scope from any active delegation",
  {
    grantee_id: z.string().describe("User ID of the potential grantee"),
    required_scope: z.string().describe("Scope to check (e.g. 'memory:write')"),
  },
  async ({ grantee_id, required_scope }) => {
    const scopes = await checkDelegatedScope(sql, grantee_id, required_scope);
    return text({ has_scope: scopes !== null, delegated_scopes: scopes });
  },
);

server.tool(
  "auth_get_delegation_summary",
  "Get a summary of all delegations (given and received) for a user",
  { user_id: z.string().describe("User ID") },
  async ({ user_id }) => text(await getDelegationSummary(sql, user_id)),
);

