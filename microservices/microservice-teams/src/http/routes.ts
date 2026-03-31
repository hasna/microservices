import type { Sql } from "postgres";
import { createWorkspace, getWorkspace, listUserWorkspaces, updateWorkspace, deleteWorkspace } from "../lib/workspaces.js";
import { listMembers, addMember, updateMemberRole, removeMember, checkPermission, transferOwnership } from "../lib/members.js";
import { createInvite, getInviteByToken, acceptInvite, listWorkspaceInvites, revokeInvite } from "../lib/invites.js";

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url); const p = url.pathname; const m = req.method;
    try {
      if (m === "GET" && p === "/health") return json({ ok: true, service: "microservice-teams" });
      // Workspaces
      if (m === "POST" && p === "/teams/workspaces") {
        const { name, owner_id, slug } = await req.json();
        return json(await createWorkspace(sql, { name, ownerId: owner_id, slug }), 201);
      }
      if (m === "GET" && p.match(/^\/teams\/workspaces\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        const ws = await getWorkspace(sql, id);
        return ws ? json(ws) : json({ error: "Not found" }, 404);
      }
      if (m === "GET" && p === "/teams/workspaces" && url.searchParams.get("user_id")) {
        return json(await listUserWorkspaces(sql, url.searchParams.get("user_id")!));
      }
      if (m === "PATCH" && p.match(/^\/teams\/workspaces\/[^/]+$/)) {
        const id = p.split("/").pop()!; const data = await req.json();
        const ws = await updateWorkspace(sql, id, data);
        return ws ? json(ws) : json({ error: "Not found" }, 404);
      }
      if (m === "DELETE" && p.match(/^\/teams\/workspaces\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        return json({ deleted: await deleteWorkspace(sql, id) });
      }
      // Members
      if (m === "GET" && p.match(/^\/teams\/workspaces\/[^/]+\/members$/)) {
        const wsId = p.split("/")[3];
        return json(await listMembers(sql, wsId));
      }
      if (m === "POST" && p.match(/^\/teams\/workspaces\/[^/]+\/members$/)) {
        const wsId = p.split("/")[3]; const { user_id, role } = await req.json();
        return json(await addMember(sql, wsId, user_id, role), 201);
      }
      if (m === "PATCH" && p.match(/^\/teams\/workspaces\/[^/]+\/members\/[^/]+$/)) {
        const parts = p.split("/"); const wsId = parts[3]; const userId = parts[5];
        const { role } = await req.json();
        const m2 = await updateMemberRole(sql, wsId, userId, role);
        return m2 ? json(m2) : json({ error: "Not found" }, 404);
      }
      if (m === "DELETE" && p.match(/^\/teams\/workspaces\/[^/]+\/members\/[^/]+$/)) {
        const parts = p.split("/"); const wsId = parts[3]; const userId = parts[5];
        return json({ removed: await removeMember(sql, wsId, userId) });
      }
      // Permission check
      if (m === "GET" && p.match(/^\/teams\/workspaces\/[^/]+\/check-permission$/)) {
        const wsId = p.split("/")[3];
        const userId = url.searchParams.get("user_id")!;
        const minRole = url.searchParams.get("role") as any ?? "member";
        return json({ allowed: await checkPermission(sql, wsId, userId, minRole) });
      }
      // Invites
      if (m === "POST" && p.match(/^\/teams\/workspaces\/[^/]+\/invites$/)) {
        const wsId = p.split("/")[3]; const { email, role, invited_by } = await req.json();
        return json(await createInvite(sql, { workspaceId: wsId, email, role, invitedBy: invited_by }), 201);
      }
      if (m === "GET" && p.match(/^\/teams\/workspaces\/[^/]+\/invites$/)) {
        return json(await listWorkspaceInvites(sql, p.split("/")[3]));
      }
      if (m === "POST" && p === "/teams/invites/accept") {
        const { token, user_id } = await req.json();
        const result = await acceptInvite(sql, token, user_id);
        return result ? json(result) : json({ error: "Invalid or expired invite" }, 400);
      }
      if (m === "DELETE" && p.match(/^\/teams\/invites\/[^/]+$/)) {
        return json({ revoked: await revokeInvite(sql, p.split("/").pop()!) });
      }
      return json({ error: "Not found" }, 404);
    } catch (err) { return json({ error: err instanceof Error ? err.message : "Server error" }, 500); }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
