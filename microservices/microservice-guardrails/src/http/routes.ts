/**
 * Guardrails HTTP routes.
 */

import { z } from "zod";
import type { Sql } from "postgres";
import { checkInput, checkOutput } from "../lib/guard.js";
import { scanPII } from "../lib/pii.js";
import { detectPromptInjection } from "../lib/injection.js";
import { createPolicy, listPolicies, updatePolicy, deletePolicy } from "../lib/policy.js";
import { listViolations } from "../lib/violations.js";
import { addAllowlistEntry, listAllowlistEntries } from "../lib/allowlist.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const CheckTextSchema = z.object({
  text: z.string().min(1),
  workspace_id: z.string().optional(),
});

const ScanPIISchema = z.object({
  text: z.string().min(1),
});

const DetectInjectionSchema = z.object({
  text: z.string().min(1),
});

const CreatePolicySchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  rules: z.array(z.object({
    type: z.enum(["block_words", "max_length", "require_format", "custom_regex"]),
    config: z.record(z.unknown()),
    action: z.enum(["block", "warn", "sanitize"]),
  })),
  active: z.boolean().optional(),
});

const UpdatePolicySchema = z.object({
  name: z.string().optional(),
  rules: z.array(z.object({
    type: z.enum(["block_words", "max_length", "require_format", "custom_regex"]),
    config: z.record(z.unknown()),
    action: z.enum(["block", "warn", "sanitize"]),
  })).optional(),
  active: z.boolean().optional(),
});

const AddAllowlistSchema = z.object({
  workspace_id: z.string().min(1),
  type: z.string().min(1),
  value: z.string().min(1),
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
          return json({ ok: true, service: "microservice-guardrails", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-guardrails", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // POST /guardrails/check-input
      if (method === "POST" && path === "/guardrails/check-input") {
        const parsed = await parseBody(req, CheckTextSchema);
        if ("error" in parsed) return parsed.error;
        const result = await checkInput(sql, parsed.data.text, parsed.data.workspace_id);
        return json(result);
      }

      // POST /guardrails/check-output
      if (method === "POST" && path === "/guardrails/check-output") {
        const parsed = await parseBody(req, CheckTextSchema);
        if ("error" in parsed) return parsed.error;
        const result = await checkOutput(sql, parsed.data.text, parsed.data.workspace_id);
        return json(result);
      }

      // POST /guardrails/scan-pii
      if (method === "POST" && path === "/guardrails/scan-pii") {
        const parsed = await parseBody(req, ScanPIISchema);
        if ("error" in parsed) return parsed.error;
        const matches = scanPII(parsed.data.text);
        return json({ matches });
      }

      // POST /guardrails/detect-injection
      if (method === "POST" && path === "/guardrails/detect-injection") {
        const parsed = await parseBody(req, DetectInjectionSchema);
        if ("error" in parsed) return parsed.error;
        const result = detectPromptInjection(parsed.data.text);
        return json(result);
      }

      // POST /guardrails/policies
      if (method === "POST" && path === "/guardrails/policies") {
        const parsed = await parseBody(req, CreatePolicySchema);
        if ("error" in parsed) return parsed.error;
        const { workspace_id, name, rules, active } = parsed.data;
        const policy = await createPolicy(sql, workspace_id, name, rules, active);
        return json(policy, 201);
      }

      // GET /guardrails/policies?workspace_id=...
      if (method === "GET" && path === "/guardrails/policies") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId) return apiError("MISSING_PARAM", "workspace_id is required");
        const policies = await listPolicies(sql, workspaceId);
        return json({ data: policies, count: policies.length });
      }

      // PATCH /guardrails/policies/:id
      if (method === "PATCH" && path.match(/^\/guardrails\/policies\/[^/]+$/)) {
        const id = path.split("/").pop()!;
        const parsed = await parseBody(req, UpdatePolicySchema);
        if ("error" in parsed) return parsed.error;
        const policy = await updatePolicy(sql, id, parsed.data);
        if (!policy) return apiError("NOT_FOUND", "Policy not found", undefined, 404);
        return json(policy);
      }

      // DELETE /guardrails/policies/:id
      if (method === "DELETE" && path.match(/^\/guardrails\/policies\/[^/]+$/)) {
        const id = path.split("/").pop()!;
        const deleted = await deletePolicy(sql, id);
        if (!deleted) return apiError("NOT_FOUND", "Policy not found", undefined, 404);
        return json({ deleted: true });
      }

      // GET /guardrails/violations?workspace_id&type&severity&limit
      if (method === "GET" && path === "/guardrails/violations") {
        const filters = {
          workspaceId: url.searchParams.get("workspace_id") ?? undefined,
          type: url.searchParams.get("type") ?? undefined,
          severity: url.searchParams.get("severity") ?? undefined,
          limit: url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : undefined,
        };
        const violations = await listViolations(sql, filters);
        return json({ data: violations, count: violations.length });
      }

      // POST /guardrails/allowlists
      if (method === "POST" && path === "/guardrails/allowlists") {
        const parsed = await parseBody(req, AddAllowlistSchema);
        if ("error" in parsed) return parsed.error;
        const { workspace_id, type, value } = parsed.data;
        const entry = await addAllowlistEntry(sql, workspace_id, type, value);
        return json(entry, 201);
      }

      // GET /guardrails/allowlists?workspace_id=...
      if (method === "GET" && path === "/guardrails/allowlists") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId) return apiError("MISSING_PARAM", "workspace_id is required");
        const entries = await listAllowlistEntries(sql, workspaceId);
        return json({ data: entries, count: entries.length });
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
