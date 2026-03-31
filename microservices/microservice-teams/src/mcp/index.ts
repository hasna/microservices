#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createWorkspace, getWorkspace, listUserWorkspaces, deleteWorkspace } from "../lib/workspaces.js";
import { listMembers, addMember, removeMember, checkPermission, transferOwnership, updateMemberRole } from "../lib/members.js";
import { createInvite, acceptInvite, listWorkspaceInvites } from "../lib/invites.js";

const server = new Server({ name: "microservice-teams", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: "teams_create_workspace", description: "Create a workspace", inputSchema: { type: "object", properties: { name: { type: "string" }, owner_id: { type: "string" } }, required: ["name", "owner_id"] } },
  { name: "teams_get_workspace", description: "Get workspace by ID", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "teams_list_workspaces", description: "List workspaces for a user", inputSchema: { type: "object", properties: { user_id: { type: "string" } }, required: ["user_id"] } },
  { name: "teams_delete_workspace", description: "Delete a workspace", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "teams_list_members", description: "List workspace members", inputSchema: { type: "object", properties: { workspace_id: { type: "string" } }, required: ["workspace_id"] } },
  { name: "teams_add_member", description: "Add member to workspace", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, user_id: { type: "string" }, role: { type: "string" } }, required: ["workspace_id", "user_id"] } },
  { name: "teams_remove_member", description: "Remove member from workspace", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, user_id: { type: "string" } }, required: ["workspace_id", "user_id"] } },
  { name: "teams_check_permission", description: "Check if user has minimum role", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, user_id: { type: "string" }, role: { type: "string" } }, required: ["workspace_id", "user_id"] } },
  { name: "teams_invite_member", description: "Invite a user by email", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, email: { type: "string" }, role: { type: "string" }, invited_by: { type: "string" } }, required: ["workspace_id", "email", "invited_by"] } },
  { name: "teams_list_invites", description: "List pending invites", inputSchema: { type: "object", properties: { workspace_id: { type: "string" } }, required: ["workspace_id"] } },
  { name: "teams_accept_invite", description: "Accept an invite by token", inputSchema: { type: "object", properties: { token: { type: "string" }, user_id: { type: "string" } }, required: ["token", "user_id"] } },
  { name: "teams_transfer_ownership", description: "Transfer workspace ownership to another member", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, current_owner_id: { type: "string" }, new_owner_id: { type: "string" } }, required: ["workspace_id", "current_owner_id", "new_owner_id"] } },
  { name: "teams_update_member_role", description: "Update a member's role in a workspace", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, user_id: { type: "string" }, role: { type: "string" } }, required: ["workspace_id", "user_id", "role"] } },
  { name: "teams_bulk_invite", description: "Invite multiple users by email", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, emails: { type: "array", items: { type: "string" } }, role: { type: "string" }, invited_by: { type: "string" } }, required: ["workspace_id", "emails", "invited_by"] } },
]}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb(); const { name, arguments: args } = req.params; const a = args as Record<string, unknown>;
  const t = (d: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }] });
  if (name === "teams_create_workspace") return t(await createWorkspace(sql, { name: String(a.name), ownerId: String(a.owner_id) }));
  if (name === "teams_get_workspace") return t(await getWorkspace(sql, String(a.id)));
  if (name === "teams_list_workspaces") return t(await listUserWorkspaces(sql, String(a.user_id)));
  if (name === "teams_delete_workspace") return t({ deleted: await deleteWorkspace(sql, String(a.id)) });
  if (name === "teams_list_members") return t(await listMembers(sql, String(a.workspace_id)));
  if (name === "teams_add_member") return t(await addMember(sql, String(a.workspace_id), String(a.user_id), (a.role as any) ?? "member"));
  if (name === "teams_remove_member") return t({ removed: await removeMember(sql, String(a.workspace_id), String(a.user_id)) });
  if (name === "teams_check_permission") return t({ allowed: await checkPermission(sql, String(a.workspace_id), String(a.user_id), (a.role as any) ?? "member") });
  if (name === "teams_invite_member") return t(await createInvite(sql, { workspaceId: String(a.workspace_id), email: String(a.email), role: (a.role as any), invitedBy: String(a.invited_by) }));
  if (name === "teams_list_invites") return t(await listWorkspaceInvites(sql, String(a.workspace_id)));
  if (name === "teams_accept_invite") return t(await acceptInvite(sql, String(a.token), String(a.user_id)));
  if (name === "teams_transfer_ownership") { await transferOwnership(sql, String(a.workspace_id), String(a.current_owner_id), String(a.new_owner_id)); return t({ ok: true }); }
  if (name === "teams_update_member_role") return t(await updateMemberRole(sql, String(a.workspace_id), String(a.user_id), (a.role as any)));
  if (name === "teams_bulk_invite") {
    const emails = Array.isArray(a.emails) ? a.emails as string[] : [];
    const results: { email: string; success: boolean; token?: string; error?: string }[] = [];
    for (const email of emails) {
      try {
        const invite = await createInvite(sql, { workspaceId: String(a.workspace_id), email, role: (a.role as any), invitedBy: String(a.invited_by) });
        results.push({ email, success: true, token: invite.token });
      } catch (e) {
        results.push({ email, success: false, error: e instanceof Error ? e.message : "Failed" });
      }
    }
    return t({ results });
  }
  throw new Error(`Unknown tool: ${name}`);
});

async function main() { const sql = getDb(); await migrate(sql); await server.connect(new StdioServerTransport()); }
main().catch(console.error);
