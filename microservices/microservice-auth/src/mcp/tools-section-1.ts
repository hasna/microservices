server.tool(
  "auth_list_users",
  "List all users",
  {
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ limit, offset }) => text(await listUsers(sql, { limit, offset })),
);

server.tool(
  "auth_get_user",
  "Get a user by ID",
  { id: z.string() },
  async ({ id }) => text(await getUserById(sql, id)),
);

server.tool(
  "auth_create_user",
  "Create a new user",
  {
    email: z.string(),
    password: z.string().optional(),
    name: z.string().optional(),
  },
  async ({ email, password, name }) =>
    text(await createUser(sql, { email, password, name })),
);

server.tool(
  "auth_delete_user",
  "Delete a user by ID",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteUser(sql, id) }),
);

server.tool(
  "auth_list_sessions",
  "List active sessions for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listUserSessions(sql, user_id)),
);

server.tool(
  "auth_revoke_session",
  "Revoke a session token",
  { token: z.string() },
  async ({ token }) => text({ revoked: await revokeSession(sql, token) }),
);

server.tool(
  "auth_revoke_all_sessions",
  "Revoke all sessions for a user",
  { user_id: z.string() },
  async ({ user_id }) =>
    text({ revoked: await revokeAllUserSessions(sql, user_id) }),
);

server.tool(
  "auth_create_api_key",
  "Create an API key for a user",
  {
    user_id: z.string(),
    name: z.string(),
    scopes: z.array(z.string()).optional(),
  },
  async ({ user_id, name, scopes }) =>
    text(await createApiKey(sql, user_id, { name, scopes })),
);

server.tool(
  "auth_list_api_keys",
  "List API keys for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listApiKeys(sql, user_id)),
);

server.tool(
  "auth_revoke_api_key",
  "Revoke an API key",
  { id: z.string(), user_id: z.string() },
  async ({ id, user_id }) => text({ revoked: await revokeApiKey(sql, id, user_id) }),
);

server.tool(
  "auth_update_user",
  "Update a user's profile (name, avatar_url, email_verified, metadata)",
  {
    id: z.string(),
    name: z.string().optional(),
    avatar_url: z.string().optional(),
    email_verified: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
  },
  async ({ id, ...updates }) => text(await updateUser(sql, id, updates as any)),
);

server.tool(
  "auth_search_users",
  "Search users by email prefix or name",
  {
    query: z.string(),
    limit: z.number().optional().default(20),
  },
  async ({ query, limit }) => {
    const q = query.toLowerCase();
    const all = await listUsers(sql, { limit });
    return text(
      all.filter(
        (u) => u.email.includes(q) || (u.name ?? "").toLowerCase().includes(q),
      ),
    );
  },
);

server.tool(
  "auth_list_passkeys",
  "List all passkeys registered for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listPasskeys(sql, user_id)),
);

server.tool(
  "auth_delete_passkey",
  "Delete a specific passkey by credential ID",
  { user_id: z.string(), credential_id: z.string() },
  async ({ user_id, credential_id }) =>
    text({ deleted: await deletePasskey(sql, user_id, credential_id) }),
);

server.tool(
  "auth_delete_all_passkeys",
  "Delete all passkeys for a user",
  { user_id: z.string() },
  async ({ user_id }) =>
    text({ deleted_all: await deleteAllPasskeys(sql, user_id) }),
);

server.tool(
  "auth_has_passkeys",
  "Check whether a user has any passkeys registered",
  { user_id: z.string() },
  async ({ user_id }) => text({ has_passkeys: await userHasPasskeys(sql, user_id) }),
);

server.tool(
  "auth_build_passkey_registration_options",
  "Build WebAuthn registration options for a new passkey",
  {
    user_id: z.string(),
    rp_name: z.string().default("Hasna Services"),
    user_name: z.string(),
    user_email: z.string(),
  },
  async ({ user_id, rp_name, user_name, user_email }) => {
    const opts = await buildRegistrationOptions(sql, user_id, {
      rpName: rp_name,
      userName: user_name,
      userEmail: user_email,
    });
    return text(opts);
  },
);

server.tool(
  "auth_build_passkey_authentication_options",
  "Build WebAuthn authentication options for a user",
  { user_email: z.string() },
  async ({ user_email }) => {
    const opts = await buildAuthenticationOptions(sql, user_email);
    return text(opts);
  },
);

server.tool(
  "auth_store_passkey",
  "Store a newly registered passkey after successful WebAuthn registration",
  {
    user_id: z.string(),
    credential_id: z.string(),
    public_key: z.string(),
    counter: z.number(),
    device_type: z.string().optional(),
    backed_up: z.boolean().optional(),
    transport: z.array(z.string()).optional(),
    authenticator_label: z.string().optional(),
  },
  async ({
    user_id,
    credential_id,
    public_key,
    counter,
    device_type,
    backed_up,
    transport,
    authenticator_label,
  }) => {
    const passkey = await createPasskey(sql, user_id, {
      credential_id,
      public_key,
      counter,
      device_type,
      backed_up,
      transport,
      authenticator_label,
    });
    return text(passkey);
  },
);

server.tool(
  "auth_update_passkey_counter",
  "Update the sign counter for a passkey after authentication",
  { credential_id: z.string(), counter: z.number() },
  async ({ credential_id, counter }) =>
    text({ updated: await updatePasskeyCounter(sql, credential_id, counter) }),
);

