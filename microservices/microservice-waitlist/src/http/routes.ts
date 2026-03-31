/**
 * HTTP route handlers for microservice-waitlist.
 */

import { z } from "zod";
import type { Sql } from "postgres";
import {
  joinWaitlist,
  getPosition,
  inviteBatch,
  listEntries,
  updateScore,
  markJoined,
  removeEntry,
} from "../lib/entries.js";
import { createCampaign, listCampaigns } from "../lib/campaigns.js";
import { getWaitlistStats } from "../lib/stats.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const JoinSchema = z.object({
  campaign_id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().optional(),
  referral_code: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const InviteBatchSchema = z.object({
  campaign_id: z.string().uuid(),
  count: z.number().int().positive(),
});

const CreateCampaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["active", "paused", "closed"]).optional(),
});

const UpdateStatusSchema = z.object({
  status: z.enum(["waiting", "invited", "joined", "removed"]),
});

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    try {
      // GET /health
      if (method === "GET" && path === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({ ok: true, service: "microservice-waitlist", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-waitlist", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // POST /waitlist/join
      if (method === "POST" && path === "/waitlist/join") {
        const parsed = await parseBody(req, JoinSchema);
        if ("error" in parsed) return parsed.error;
        const body = parsed.data;
        const entry = await joinWaitlist(sql, {
          campaignId: body.campaign_id,
          email: body.email,
          name: body.name,
          referralCode: body.referral_code,
          metadata: body.metadata,
        });
        return json(entry, 201);
      }

      // GET /waitlist/position/:id
      if (method === "GET" && path.match(/^\/waitlist\/position\/[^/]+$/)) {
        const id = path.split("/").pop()!;
        const position = await getPosition(sql, id);
        return json(position);
      }

      // POST /waitlist/invite-batch
      if (method === "POST" && path === "/waitlist/invite-batch") {
        const parsed = await parseBody(req, InviteBatchSchema);
        if ("error" in parsed) return parsed.error;
        const { campaign_id, count } = parsed.data;
        const invited = await inviteBatch(sql, campaign_id, count);
        return json({ data: invited, count: invited.length });
      }

      // GET /waitlist/stats/:campaign_id
      if (method === "GET" && path.match(/^\/waitlist\/stats\/[^/]+$/)) {
        const campaignId = path.split("/").pop()!;
        const stats = await getWaitlistStats(sql, campaignId);
        return json(stats);
      }

      // POST /waitlist/campaigns
      if (method === "POST" && path === "/waitlist/campaigns") {
        const parsed = await parseBody(req, CreateCampaignSchema);
        if ("error" in parsed) return parsed.error;
        const campaign = await createCampaign(sql, parsed.data);
        return json(campaign, 201);
      }

      // GET /waitlist/campaigns
      if (method === "GET" && path === "/waitlist/campaigns") {
        const status = url.searchParams.get("status") ?? undefined;
        const campaigns = await listCampaigns(sql, status);
        return json({ data: campaigns, count: campaigns.length });
      }

      // GET /waitlist/entries
      if (method === "GET" && path === "/waitlist/entries") {
        const campaignId = url.searchParams.get("campaign_id");
        if (!campaignId) return apiError("MISSING_PARAM", "campaign_id is required");
        const status = url.searchParams.get("status") ?? undefined;
        const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : undefined;
        const entries = await listEntries(sql, campaignId, status, limit);
        return json({ data: entries, count: entries.length });
      }

      // PATCH /waitlist/entries/:id/status
      if (method === "PATCH" && path.match(/^\/waitlist\/entries\/[^/]+\/status$/)) {
        const parts = path.split("/");
        const id = parts[parts.length - 2];
        const parsed = await parseBody(req, UpdateStatusSchema);
        if ("error" in parsed) return parsed.error;
        const { status } = parsed.data;
        if (status === "joined") {
          await markJoined(sql, id);
        } else if (status === "removed") {
          await removeEntry(sql, id);
        } else if (status === "waiting" || status === "invited") {
          await sql`UPDATE waitlist.entries SET status = ${status} WHERE id = ${id}`;
        }
        const [entry] = await sql`SELECT * FROM waitlist.entries WHERE id = ${id}`;
        if (!entry) return apiError("NOT_FOUND", "Entry not found", undefined, 404);
        return json(entry);
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      return apiError("INTERNAL_ERROR", msg, undefined, 500);
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function apiError(code: string, message: string, fields?: Record<string, string>, status = 400): Response {
  return json({ error: { code, message, ...(fields ? { fields } : {}) } }, status);
}

async function parseBody<T>(req: Request, schema: z.ZodSchema<T>): Promise<{ data: T } | { error: Response }> {
  try {
    const raw = await req.json();
    const result = schema.safeParse(raw);
    if (!result.success) {
      const fields = Object.fromEntries(result.error.errors.map(e => [e.path.join(".") || "body", e.message]));
      return { error: apiError("VALIDATION_ERROR", "Invalid request body", fields) };
    }
    return { data: result.data };
  } catch {
    return { error: apiError("INVALID_JSON", "Request body must be valid JSON") };
  }
}
