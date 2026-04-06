// --- Simple passkey (byte-based challenge/response) ---

server.tool(
  "auth_create_passkey",
  "Create a new passkey credential (simple registration flow)",
  {
    user_id: z.string(),
    credential_id: z.string(),
    public_key: z.string(),
    counter: z.number().optional(),
    device_type: z.string().optional(),
  },
  async ({ user_id, credential_id, public_key, counter, device_type }) =>
    text(await createPasskeyCredential(sql, user_id, {
      credentialId: credential_id,
      publicKey: public_key,
      counter,
      deviceType: device_type,
    })),
);

server.tool(
  "auth_verify_passkey",
  "Verify a passkey authentication response",
  {
    challenge_id: z.string(),
    credential_id: z.string(),
    counter: z.number(),
    signature: z.string(),
  },
  async ({ challenge_id, credential_id, counter, signature }) =>
    text(await verifyPasskey(sql, challenge_id, credential_id, counter, signature)),
);

server.tool(
  "auth_list_passkeys_simple",
  "List all passkey credentials for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listPasskeyCredentials(sql, user_id)),
);

server.tool(
  "auth_delete_passkey_simple",
  "Delete a specific passkey credential by credential ID",
  { user_id: z.string(), credential_id: z.string() },
  async ({ user_id, credential_id }) =>
    text({ deleted: await deletePasskeyCredential(sql, user_id, credential_id) }),
);

server.tool(
  "auth_delete_all_passkeys_simple",
  "Delete all passkey credentials for a user",
  { user_id: z.string() },
  async ({ user_id }) =>
    text({ deleted_count: await deleteAllPasskeyCredentials(sql, user_id) }),
);

server.tool(
  "auth_authenticate_passkey",
  "Start passkey authentication — issue a challenge for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await authenticatePasskey(sql, user_id)),
);

