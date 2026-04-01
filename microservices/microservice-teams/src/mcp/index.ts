#!/usr/bin/env bun
/**
 * MCP server for microservice-teams.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  acceptInvite,
  createInvite,
  listWorkspaceInvites,
} from "../lib/invites.js";
import {
  addMember,
  checkPermission,
  listMembers,
  removeMember,
  transferOwnership,
  updateMemberRole,
} from "../lib/members.js";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listUserWorkspaces,
} from "../lib/workspaces.js";

const server = new McpServer({
  name: "microservice-teams",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// Role enum for validation
const RoleSchema = z.enum(["owner", "admin", "member", "viewer"]);

server.tool(
  "teams_create_workspace",
  "Create a workspace",
  {
    name: z.string(),
    owner_id: z.string(),
  },
  async ({ name, owner_id }) =>
    text(await createWorkspace(sql, { name, ownerId: owner_id })),
);

server.tool(
  "teams_get_workspace",
  "Get workspace by ID",
  { id: z.string() },
  async ({ id }) => text(await getWorkspace(sql, id)),
);

server.tool(
  "teams_list_workspaces",
  "List workspaces for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listUserWorkspaces(sql, user_id)),
);

server.tool(
  "teams_delete_workspace",
  "Delete a workspace",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteWorkspace(sql, id) }),
);

server.tool(
  "teams_list_members",
  "List workspace members",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listMembers(sql, workspace_id)),
);

server.tool(
  "teams_add_member",
  "Add member to workspace",
  {
    workspace_id: z.string(),
    user_id: z.string(),
    role: RoleSchema.optional().default("member"),
  },
  async ({ workspace_id, user_id, role }) =>
    text(await addMember(sql, workspace_id, user_id, role as any)),
);

server.tool(
  "teams_remove_member",
  "Remove member from workspace",
  {
    workspace_id: z.string(),
    user_id: z.string(),
  },
  async ({ workspace_id, user_id }) =>
    text({ removed: await removeMember(sql, workspace_id, user_id) }),
);

server.tool(
  "teams_check_permission",
  "Check if user has minimum role",
  {
    workspace_id: z.string(),
    user_id: z.string(),
    role: RoleSchema.optional().default("member"),
  },
  async ({ workspace_id, user_id, role }) =>
    text({
      allowed: await checkPermission(sql, workspace_id, user_id, role as any),
    }),
);

server.tool(
  "teams_invite_member",
  "Invite a user by email",
  {
    workspace_id: z.string(),
    email: z.string().email(),
    role: RoleSchema,
    invited_by: z.string(),
  },
  async ({ workspace_id, email, role, invited_by }) =>
    text(
      await createInvite(sql, {
        workspaceId: workspace_id,
        email,
        role: role as any,
        invitedBy: invited_by,
      }),
    ),
);

server.tool(
  "teams_list_invites",
  "List pending invites",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listWorkspaceInvites(sql, workspace_id)),
);

server.tool(
  "teams_accept_invite",
  "Accept an invite by token",
  {
    token: z.string(),
    user_id: z.string(),
  },
  async ({ token, user_id }) => text(await acceptInvite(sql, token, user_id)),
);

server.tool(
  "teams_transfer_ownership",
  "Transfer workspace ownership to another member",
  {
    workspace_id: z.string(),
    current_owner_id: z.string(),
    new_owner_id: z.string(),
  },
  async ({ workspace_id, current_owner_id, new_owner_id }) => {
    await transferOwnership(sql, workspace_id, current_owner_id, new_owner_id);
    return text({ ok: true });
  },
);

server.tool(
  "teams_update_member_role",
  "Update a member's role in a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string(),
    role: RoleSchema,
  },
  async ({ workspace_id, user_id, role }) =>
    text(await updateMemberRole(sql, workspace_id, user_id, role as any)),
);

server.tool(
  "teams_bulk_invite",
  "Invite multiple users by email",
  {
    workspace_id: z.string(),
    emails: z.array(z.string().email()),
    role: RoleSchema,
    invited_by: z.string(),
  },
  async ({ workspace_id, emails, role, invited_by }) => {
    const results: {
      email: string;
      success: boolean;
      token?: string;
      error?: string;
    }[] = [];
    for (const email of emails) {
      try {
        const invite = await createInvite(sql, {
          workspaceId: workspace_id,
          email,
          role: role as any,
          invitedBy: invited_by,
        });
        results.push({ email, success: true, token: invite.token });
      } catch (e) {
        results.push({
          email,
          success: false,
          error: e instanceof Error ? e.message : "Failed",
        });
      }
    }
    return text({ results });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
