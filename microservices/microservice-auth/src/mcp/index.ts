#!/usr/bin/env bun
/**
 * MCP server for microservice-auth.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { listUsers, getUserById, createUser, deleteUser } from "../lib/users.js";
import { listUserSessions, revokeSession, revokeAllUserSessions } from "../lib/sessions.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../lib/api-keys.js";

const server = new Server(
  { name: "microservice-auth", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "auth_list_users", description: "List all users", inputSchema: { type: "object", properties: { limit: { type: "number" }, offset: { type: "number" } }, required: [] } },
    { name: "auth_get_user", description: "Get a user by ID", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "auth_create_user", description: "Create a new user", inputSchema: { type: "object", properties: { email: { type: "string" }, password: { type: "string" }, name: { type: "string" } }, required: ["email"] } },
    { name: "auth_delete_user", description: "Delete a user by ID", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "auth_list_sessions", description: "List active sessions for a user", inputSchema: { type: "object", properties: { user_id: { type: "string" } }, required: ["user_id"] } },
    { name: "auth_revoke_session", description: "Revoke a session token", inputSchema: { type: "object", properties: { token: { type: "string" } }, required: ["token"] } },
    { name: "auth_revoke_all_sessions", description: "Revoke all sessions for a user", inputSchema: { type: "object", properties: { user_id: { type: "string" } }, required: ["user_id"] } },
    { name: "auth_create_api_key", description: "Create an API key for a user", inputSchema: { type: "object", properties: { user_id: { type: "string" }, name: { type: "string" }, scopes: { type: "array", items: { type: "string" } } }, required: ["user_id", "name"] } },
    { name: "auth_list_api_keys", description: "List API keys for a user", inputSchema: { type: "object", properties: { user_id: { type: "string" } }, required: ["user_id"] } },
    { name: "auth_revoke_api_key", description: "Revoke an API key", inputSchema: { type: "object", properties: { id: { type: "string" }, user_id: { type: "string" } }, required: ["id", "user_id"] } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as Record<string, unknown>;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "auth_list_users") return text(await listUsers(sql, { limit: Number(a.limit ?? 50), offset: Number(a.offset ?? 0) }));
  if (name === "auth_get_user") return text(await getUserById(sql, String(a.id)));
  if (name === "auth_create_user") return text(await createUser(sql, { email: String(a.email), password: a.password ? String(a.password) : undefined, name: a.name ? String(a.name) : undefined }));
  if (name === "auth_delete_user") return text({ deleted: await deleteUser(sql, String(a.id)) });
  if (name === "auth_list_sessions") return text(await listUserSessions(sql, String(a.user_id)));
  if (name === "auth_revoke_session") return text({ revoked: await revokeSession(sql, String(a.token)) });
  if (name === "auth_revoke_all_sessions") return text({ revoked: await revokeAllUserSessions(sql, String(a.user_id)) });
  if (name === "auth_create_api_key") return text(await createApiKey(sql, String(a.user_id), { name: String(a.name), scopes: a.scopes as string[] | undefined }));
  if (name === "auth_list_api_keys") return text(await listApiKeys(sql, String(a.user_id)));
  if (name === "auth_revoke_api_key") return text({ revoked: await revokeApiKey(sql, String(a.id), String(a.user_id)) });

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
