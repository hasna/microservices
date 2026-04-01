#!/usr/bin/env bun
/**
 * MCP server for microservice-auth.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../lib/api-keys.js";
import {
  listUserSessions,
  revokeAllUserSessions,
  revokeSession,
} from "../lib/sessions.js";
import {
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  updateUser,
} from "../lib/users.js";

const server = new McpServer({
  name: "microservice-auth",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

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

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
