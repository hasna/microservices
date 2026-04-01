import type { Sql } from "postgres";
import { z } from "zod";
import {
  acceptInvite,
  createInvite,
  listWorkspaceInvites,
  revokeInvite,
} from "../lib/invites.js";
import {
  addMember,
  checkPermission,
  getMember,
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
  updateWorkspace,
} from "../lib/workspaces.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const CreateWorkspaceSchema = z.object({
  name: z.string().min(1),
  owner_id: z.string().uuid(),
  slug: z.string().optional(),
});
const UpdateWorkspaceSchema = z.object({ name: z.string().min(1).optional() });
const AddMemberSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["owner", "admin", "member", "viewer"]).optional(),
});
const UpdateRoleSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
});
const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "viewer"]).optional(),
  invited_by: z.string().uuid(),
});
const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  user_id: z.string().uuid(),
});
const TransferOwnershipSchema = z.object({
  current_owner_id: z.string().uuid(),
  new_owner_id: z.string().uuid(),
});
const LeaveWorkspaceSchema = z.object({ user_id: z.string().uuid() });
const BulkInviteSchema = z.object({
  emails: z.array(z.string().email()).min(1),
  role: z.enum(["admin", "member", "viewer"]).optional(),
  invited_by: z.string().uuid(),
});

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;

    // CORS preflight
    if (m === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (m === "GET" && p === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({
            ok: true,
            service: "microservice-teams",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-teams",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
        }
      }
      // Workspaces
      if (m === "POST" && p === "/teams/workspaces") {
        const parsed = await parseBody(req, CreateWorkspaceSchema);
        if ("error" in parsed) return parsed.error;
        return json(
          await createWorkspace(sql, {
            name: parsed.data.name,
            ownerId: parsed.data.owner_id,
            slug: parsed.data.slug,
          }),
          201,
        );
      }
      if (m === "GET" && p.match(/^\/teams\/workspaces\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        const ws = await getWorkspace(sql, id);
        return ws
          ? json(ws)
          : apiError("NOT_FOUND", "Not found", undefined, 404);
      }
      if (
        m === "GET" &&
        p === "/teams/workspaces" &&
        url.searchParams.get("user_id")
      ) {
        const workspaces = await listUserWorkspaces(
          sql,
          url.searchParams.get("user_id")!,
        );
        return json({ data: workspaces, count: workspaces.length });
      }
      if (m === "PATCH" && p.match(/^\/teams\/workspaces\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        const parsed = await parseBody(req, UpdateWorkspaceSchema);
        if ("error" in parsed) return parsed.error;
        const ws = await updateWorkspace(sql, id, parsed.data);
        return ws
          ? json(ws)
          : apiError("NOT_FOUND", "Not found", undefined, 404);
      }
      if (m === "DELETE" && p.match(/^\/teams\/workspaces\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        return json({ deleted: await deleteWorkspace(sql, id) });
      }
      // Members
      if (m === "GET" && p.match(/^\/teams\/workspaces\/[^/]+\/members$/)) {
        const wsId = p.split("/")[3];
        const members = await listMembers(sql, wsId);
        return json({ data: members, count: members.length });
      }
      if (m === "POST" && p.match(/^\/teams\/workspaces\/[^/]+\/members$/)) {
        const wsId = p.split("/")[3];
        const parsed = await parseBody(req, AddMemberSchema);
        if ("error" in parsed) return parsed.error;
        return json(
          await addMember(sql, wsId, parsed.data.user_id, parsed.data.role),
          201,
        );
      }
      if (
        m === "PATCH" &&
        p.match(/^\/teams\/workspaces\/[^/]+\/members\/[^/]+$/)
      ) {
        const parts = p.split("/");
        const wsId = parts[3];
        const userId = parts[5];
        const parsed = await parseBody(req, UpdateRoleSchema);
        if ("error" in parsed) return parsed.error;
        const member = await updateMemberRole(
          sql,
          wsId,
          userId,
          parsed.data.role,
        );
        return member
          ? json(member)
          : apiError("NOT_FOUND", "Not found", undefined, 404);
      }
      if (
        m === "DELETE" &&
        p.match(/^\/teams\/workspaces\/[^/]+\/members\/[^/]+$/)
      ) {
        const parts = p.split("/");
        const wsId = parts[3];
        const userId = parts[5];
        return json({ removed: await removeMember(sql, wsId, userId) });
      }
      // Permission check
      if (
        m === "GET" &&
        p.match(/^\/teams\/workspaces\/[^/]+\/check-permission$/)
      ) {
        const wsId = p.split("/")[3];
        const userId = url.searchParams.get("user_id")!;
        const minRole = (url.searchParams.get("role") as any) ?? "member";
        return json({
          allowed: await checkPermission(sql, wsId, userId, minRole),
        });
      }
      // Invites
      if (m === "POST" && p.match(/^\/teams\/workspaces\/[^/]+\/invites$/)) {
        const wsId = p.split("/")[3];
        const parsed = await parseBody(req, InviteSchema);
        if ("error" in parsed) return parsed.error;
        return json(
          await createInvite(sql, {
            workspaceId: wsId,
            email: parsed.data.email,
            role: parsed.data.role,
            invitedBy: parsed.data.invited_by,
          }),
          201,
        );
      }
      if (m === "GET" && p.match(/^\/teams\/workspaces\/[^/]+\/invites$/)) {
        const invites = await listWorkspaceInvites(sql, p.split("/")[3]);
        return json({ data: invites, count: invites.length });
      }
      if (m === "POST" && p === "/teams/invites/accept") {
        const parsed = await parseBody(req, AcceptInviteSchema);
        if ("error" in parsed) return parsed.error;
        const result = await acceptInvite(
          sql,
          parsed.data.token,
          parsed.data.user_id,
        );
        return result
          ? json(result)
          : apiError(
              "INVALID_INVITE",
              "Invalid or expired invite",
              undefined,
              400,
            );
      }
      if (m === "DELETE" && p.match(/^\/teams\/invites\/[^/]+$/)) {
        return json({ revoked: await revokeInvite(sql, p.split("/").pop()!) });
      }
      // Transfer ownership
      if (m === "POST" && p.match(/^\/teams\/workspaces\/[^/]+\/transfer$/)) {
        const wsId = p.split("/")[3];
        const parsed = await parseBody(req, TransferOwnershipSchema);
        if ("error" in parsed) return parsed.error;
        const ws = await getWorkspace(sql, wsId);
        if (!ws)
          return apiError("NOT_FOUND", "Workspace not found", undefined, 404);
        if (ws.owner_id !== parsed.data.current_owner_id)
          return apiError(
            "FORBIDDEN",
            "Requester is not the owner",
            undefined,
            403,
          );
        await transferOwnership(
          sql,
          wsId,
          parsed.data.current_owner_id,
          parsed.data.new_owner_id,
        );
        return json({ ok: true });
      }
      // Leave workspace (self-service)
      if (m === "POST" && p.match(/^\/teams\/workspaces\/[^/]+\/leave$/)) {
        const wsId = p.split("/")[3];
        const parsed = await parseBody(req, LeaveWorkspaceSchema);
        if ("error" in parsed) return parsed.error;
        const member = await getMember(sql, wsId, parsed.data.user_id);
        if (!member)
          return apiError("NOT_FOUND", "Member not found", undefined, 404);
        if (member.role === "owner")
          return apiError(
            "FORBIDDEN",
            "Owners cannot leave — transfer ownership first",
            undefined,
            403,
          );
        await removeMember(sql, wsId, parsed.data.user_id);
        return json({ ok: true });
      }
      // Bulk invite
      if (
        m === "POST" &&
        p.match(/^\/teams\/workspaces\/[^/]+\/invites\/bulk$/)
      ) {
        const wsId = p.split("/")[3];
        const parsed = await parseBody(req, BulkInviteSchema);
        if ("error" in parsed) return parsed.error;
        const results: {
          email: string;
          success: boolean;
          token?: string;
          error?: string;
        }[] = [];
        for (const email of parsed.data.emails) {
          try {
            const invite = await createInvite(sql, {
              workspaceId: wsId,
              email,
              role: parsed.data.role,
              invitedBy: parsed.data.invited_by,
            });
            results.push({ email, success: true, token: invite.token });
          } catch (e) {
            results.push({
              email,
              success: false,
              error: e instanceof Error ? e.message : "Failed to create invite",
            });
          }
        }
        return json({ results });
      }
      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : "Server error" },
        500,
      );
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function apiError(
  code: string,
  message: string,
  fields?: Record<string, string>,
  status = 400,
): Response {
  return json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    status,
  );
}

async function parseBody<T>(
  req: Request,
  schema: z.ZodSchema<T>,
): Promise<{ data: T } | { error: Response }> {
  try {
    const raw = await req.json();
    const result = schema.safeParse(raw);
    if (!result.success) {
      const fields = Object.fromEntries(
        result.error.errors.map((e) => [e.path.join(".") || "body", e.message]),
      );
      return {
        error: apiError("VALIDATION_ERROR", "Invalid request body", fields),
      };
    }
    return { data: result.data };
  } catch {
    return {
      error: apiError("INVALID_JSON", "Request body must be valid JSON"),
    };
  }
}
