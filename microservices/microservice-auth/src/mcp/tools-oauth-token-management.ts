// --- OAuth token management ---

server.tool(
  "auth_create_oauth_token",
  "Create OAuth access + refresh token set for a user+client",
  {
    user_id: z.string().describe("User UUID"),
    client_id: z.string().describe("OAuth client ID"),
    scopes: z.array(z.string()).describe("Permission scopes"),
  },
  async ({ user_id, client_id, scopes }) =>
    text(await createOAuthTokenSet(sql, user_id, client_id, scopes)),
);

server.tool(
  "auth_refresh_oauth_token",
  "Refresh an OAuth access token using a refresh token",
  { refresh_token: z.string().describe("OAuth refresh token") },
  async ({ refresh_token }) => {
    const result = await refreshOAuthToken(sql, refresh_token);
    return result ? text(result) : text({ error: "Invalid or expired refresh token" });
  },
);

server.tool(
  "auth_revoke_oauth_token",
  "Revoke an OAuth access token",
  { access_token: z.string().describe("OAuth access token") },
  async ({ access_token }) =>
    text({ revoked: await revokeOAuthToken(sql, access_token) }),
);

server.tool(
  "auth_list_oauth_tokens",
  "List active OAuth tokens for a user",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) => text(await listUserOAuthTokens(sql, user_id)),
);

server.tool(
  "auth_register_oauth_client",
  "Register a new OAuth client application",
  {
    name: z.string().describe("Client application name"),
    redirect_uris: z.array(z.string()).describe("Allowed redirect URIs"),
    scopes: z.array(z.string()).describe("Allowed OAuth scopes"),
  },
  async ({ name, redirect_uris, scopes }) =>
    text(await registerOAuthClient(sql, name, redirect_uris, scopes)),
);

server.tool(
  "auth_list_user_oauth_accounts",
  "List all OAuth accounts linked to a user",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) => text(await listUserOAuthAccounts(sql, user_id)),
);

server.tool(
  "auth_get_oauth_account",
  "Get a specific OAuth account by provider and provider ID",
  {
    provider: z.string().describe("OAuth provider name (e.g. google, github)"),
    provider_id: z.string().describe("User ID from the OAuth provider"),
  },
  async ({ provider, provider_id }) => text(await getOAuthAccount(sql, provider, provider_id)),
);

server.tool(
  "auth_unlink_oauth_account",
  "Unlink an OAuth account from a user",
  {
    user_id: z.string().describe("User UUID"),
    provider: z.string().describe("OAuth provider name to unlink"),
  },
  async ({ user_id, provider }) => text({ unlinked: await unlinkOAuthAccount(sql, user_id, provider) }),
);

