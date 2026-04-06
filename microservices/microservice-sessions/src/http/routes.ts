/**
 * Sessions HTTP routes.
 */

import type { Sql } from "postgres";
import { z } from "zod";
import { getContextWindow } from "../lib/context.js";
import {
  createConversation,
  deleteConversation,
  forkConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "../lib/conversations.js";
import { exportConversation } from "../lib/export.js";
import {
  addMessage,
  getMessages,
  pinMessage,
  searchMessages,
} from "../lib/messages.js";
import { pinFork, unpinFork } from "../lib/fork-pinning.js";
import {
  createScheduledArchival,
  getScheduledArchival,
} from "../lib/session-scheduler.js";
import { listRetentionPolicyRules } from "../lib/session-retention-policies.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const CreateConversationSchema = z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().optional(),
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateConversationSchema = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  is_archived: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const AddMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
  tool_calls: z.unknown().optional(),
  tokens: z.number().int().optional(),
  latency_ms: z.number().int().optional(),
  model: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const SearchMessagesSchema = z.object({
  workspace_id: z.string().uuid(),
  query: z.string().min(1),
  conversation_id: z.string().uuid().optional(),
  limit: z.number().int().positive().optional(),
});

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // GET /health
      if (method === "GET" && path === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({
            ok: true,
            service: "microservice-sessions",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-sessions",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
        }
      }

      // POST /sessions/conversations
      if (method === "POST" && path === "/sessions/conversations") {
        const parsed = await parseBody(req, CreateConversationSchema);
        if ("error" in parsed) return parsed.error;
        const conv = await createConversation(sql, parsed.data);
        return json(conv, 201);
      }

      // GET /sessions/conversations?workspace_id&user_id&archived&search&limit
      if (method === "GET" && path === "/sessions/conversations") {
        const workspaceId = url.searchParams.get("workspace_id");
        const userId = url.searchParams.get("user_id");
        if (!workspaceId || !userId)
          return apiError(
            "VALIDATION_ERROR",
            "workspace_id and user_id are required",
          );
        const archived = url.searchParams.get("archived");
        const search = url.searchParams.get("search") ?? undefined;
        const limit = url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!, 10)
          : undefined;
        const offset = url.searchParams.get("offset")
          ? parseInt(url.searchParams.get("offset")!, 10)
          : undefined;
        const convs = await listConversations(sql, workspaceId, userId, {
          archived: archived !== null ? archived === "true" : undefined,
          search,
          limit,
          offset,
        });
        return json({ data: convs, count: convs.length });
      }

      // GET /sessions/conversations/:id
      if (
        method === "GET" &&
        path.match(/^\/sessions\/conversations\/[^/]+$/) &&
        !path.includes("/messages") &&
        !path.includes("/context") &&
        !path.includes("/export") &&
        !path.includes("/fork")
      ) {
        const id = path.split("/").pop()!;
        const conv = await getConversation(sql, id);
        return conv
          ? json(conv)
          : apiError("NOT_FOUND", "Conversation not found", undefined, 404);
      }

      // PATCH /sessions/conversations/:id
      if (
        method === "PATCH" &&
        path.match(/^\/sessions\/conversations\/[^/]+$/)
      ) {
        const id = path.split("/").pop()!;
        const parsed = await parseBody(req, UpdateConversationSchema);
        if ("error" in parsed) return parsed.error;
        const conv = await updateConversation(sql, id, parsed.data);
        return conv
          ? json(conv)
          : apiError("NOT_FOUND", "Conversation not found", undefined, 404);
      }

      // DELETE /sessions/conversations/:id
      if (
        method === "DELETE" &&
        path.match(/^\/sessions\/conversations\/[^/]+$/)
      ) {
        const id = path.split("/").pop()!;
        const ok = await deleteConversation(sql, id);
        return json({ ok });
      }

      // POST /sessions/conversations/:id/fork?from_message_id=X
      if (
        method === "POST" &&
        path.match(/^\/sessions\/conversations\/[^/]+\/fork$/)
      ) {
        const parts = path.split("/");
        const id = parts[3];
        const fromMessageId = url.searchParams.get("from_message_id");
        if (!fromMessageId)
          return apiError(
            "VALIDATION_ERROR",
            "from_message_id query parameter is required",
          );
        const forked = await forkConversation(sql, id, fromMessageId);
        return forked
          ? json(forked, 201)
          : apiError(
              "NOT_FOUND",
              "Conversation or message not found",
              undefined,
              404,
            );
      }

      // POST /sessions/conversations/:id/messages
      if (
        method === "POST" &&
        path.match(/^\/sessions\/conversations\/[^/]+\/messages$/)
      ) {
        const parts = path.split("/");
        const convId = parts[3];
        const parsed = await parseBody(req, AddMessageSchema);
        if ("error" in parsed) return parsed.error;
        const msg = await addMessage(sql, convId, parsed.data);
        return json(msg, 201);
      }

      // GET /sessions/conversations/:id/messages?limit&before&role
      if (
        method === "GET" &&
        path.match(/^\/sessions\/conversations\/[^/]+\/messages$/)
      ) {
        const parts = path.split("/");
        const convId = parts[3];
        const limit = url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!, 10)
          : undefined;
        const before = url.searchParams.get("before") ?? undefined;
        const after = url.searchParams.get("after") ?? undefined;
        const role = url.searchParams.get("role") ?? undefined;
        const msgs = await getMessages(sql, convId, {
          limit,
          before,
          after,
          role,
        });
        return json({ data: msgs, count: msgs.length });
      }

      // GET /sessions/conversations/:id/context?max_tokens=4096
      if (
        method === "GET" &&
        path.match(/^\/sessions\/conversations\/[^/]+\/context$/)
      ) {
        const parts = path.split("/");
        const convId = parts[3];
        const maxTokens = parseInt(
          url.searchParams.get("max_tokens") ?? "4096",
          10,
        );
        const ctx = await getContextWindow(sql, convId, maxTokens);
        return json(ctx);
      }

      // GET /sessions/conversations/:id/export?format=markdown
      if (
        method === "GET" &&
        path.match(/^\/sessions\/conversations\/[^/]+\/export$/)
      ) {
        const parts = path.split("/");
        const convId = parts[3];
        const format = (url.searchParams.get("format") ?? "markdown") as
          | "markdown"
          | "json";
        if (format !== "markdown" && format !== "json") {
          return apiError(
            "VALIDATION_ERROR",
            "format must be 'markdown' or 'json'",
          );
        }
        const output = await exportConversation(sql, convId, format);
        const contentType =
          format === "json" ? "application/json" : "text/markdown";
        return new Response(output, {
          status: 200,
          headers: { "Content-Type": contentType, ...corsHeaders },
        });
      }

      // POST /sessions/messages/search
      if (method === "POST" && path === "/sessions/messages/search") {
        const parsed = await parseBody(req, SearchMessagesSchema);
        if ("error" in parsed) return parsed.error;
        const msgs = await searchMessages(
          sql,
          parsed.data.workspace_id,
          parsed.data.query,
          {
            conversationId: parsed.data.conversation_id,
            limit: parsed.data.limit,
          },
        );
        return json({ data: msgs, count: msgs.length });
      }

      // PATCH /sessions/messages/:id/pin
      if (
        method === "PATCH" &&
        path.match(/^\/sessions\/messages\/[^/]+\/pin$/)
      ) {
        const parts = path.split("/");
        const id = parts[3];
        const msg = await pinMessage(sql, id);
        return msg
          ? json(msg)
          : apiError("NOT_FOUND", "Message not found", undefined, 404);
      }

      // GET /sessions/scheduled/:workspace_id — list scheduled archivals for a workspace
      if (
        method === "GET" &&
        path.match(/^\/sessions\/scheduled\/[^/]+$/)
      ) {
        const workspaceId = path.split("/")[3];
        const status = url.searchParams.get("status") ?? undefined;
        const action = url.searchParams.get("action") ?? undefined;
        const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 50;
        const offset = url.searchParams.get("offset") ? parseInt(url.searchParams.get("offset")!, 10) : 0;
        const statusFilter = status ? sql`AND sa.status = ${status}` : sql``;
        const actionFilter = action ? sql`AND sa.action = ${action}` : sql``;
        const rows = await sql`
          SELECT sa.*, c.title as session_title
          FROM sessions.scheduled_archivals sa
          JOIN sessions.conversations c ON c.id = sa.session_id
          WHERE c.workspace_id = ${workspaceId}
            ${statusFilter}
            ${actionFilter}
          ORDER BY sa.scheduled_for ASC
          LIMIT ${limit} OFFSET ${offset}
        `;
        return json({ workspace_id: workspaceId, archivals: rows, count: rows.length, limit, offset });
      }

      // POST /sessions/scheduled/bulk — bulk schedule archival for multiple sessions
      if (method === "POST" && path === "/sessions/scheduled/bulk") {
        const BulkScheduleSchema = z.object({
          session_ids: z.array(z.string().uuid()).min(1).max(200),
          scheduled_for: z.string(),
          action: z.enum(["archive", "delete", "snapshot_then_delete", "summarize"]),
          retention_policy_id: z.string().uuid().optional(),
        });
        const parsed = await parseBody(req, BulkScheduleSchema);
        if ("error" in parsed) return parsed.error;
        const scheduledFor = new Date(parsed.data.scheduled_for);
        const results: { session_id: string; archival_id: string | null; error?: string }[] = [];
        for (const sid of parsed.data.session_ids) {
          try {
            const arch = await createScheduledArchival(sql, {
              sessionId: sid,
              scheduledFor,
              action: parsed.data.action,
              retentionPolicyId: parsed.data.retention_policy_id,
            });
            results.push({ session_id: sid, archival_id: arch.id });
          } catch (e) {
            results.push({ session_id: sid, archival_id: null, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return json({
          total: results.length,
          scheduled: results.filter(r => r.archival_id !== null).length,
          errors: results.filter(r => r.error).length,
          results,
        }, 201);
      }

      // GET /sessions/retention/:workspace_id — list retention policies for a workspace
      if (
        method === "GET" &&
        path.match(/^\/sessions\/retention\/[^/]+$/)
      ) {
        const workspaceId = path.split("/")[3];
        const enabled = url.searchParams.get("enabled");
        const trigger = url.searchParams.get("trigger") ?? undefined;
        const action = url.searchParams.get("action") ?? undefined;
        const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 50;
        const offset = url.searchParams.get("offset") ? parseInt(url.searchParams.get("offset")!, 10) : 0;
        const enabledFilter = enabled !== null ? { enabled: enabled === "true" } : {};
        const policies = await listRetentionPolicyRules(sql, workspaceId, { trigger, action, ...enabledFilter, limit, offset });
        return json({ workspace_id: workspaceId, policies, count: policies.length, limit, offset });
      }

      // POST /sessions/forks/:fork_id/pin — pin a fork
      if (
        method === "POST" &&
        path.match(/^\/sessions\/forks\/[^/]+\/pin$/)
      ) {
        const forkId = path.split("/")[3];
        const body = await req.json().catch(() => ({}));
        const pin = await pinFork(sql, forkId, {
          pinnedBy: body.pinned_by ?? null,
          pinNote: body.pin_note ?? null,
          autoProtect: body.auto_protect ?? true,
        });
        return json(pin, 201);
      }

      // DELETE /sessions/forks/:fork_id/pin — unpin a fork
      if (
        method === "DELETE" &&
        path.match(/^\/sessions\/forks\/[^/]+\/pin$/)
      ) {
        const forkId = path.split("/")[3];
        const unpinned = await unpinFork(sql, forkId);
        return json({ fork_id: forkId, unpinned });
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      return json({ error: msg }, 500);
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
