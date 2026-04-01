import type { Sql } from "postgres";
import { z } from "zod";
import { evaluateAllFlags, evaluateFlag } from "../lib/evaluate.js";
import {
  assignVariant,
  createExperiment,
  listExperiments,
  updateExperimentStatus,
} from "../lib/experiments.js";
import {
  addRule,
  createFlag,
  deleteFlag,
  getFlag,
  listFlags,
  setOverride,
  updateFlag,
} from "../lib/flags.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const CreateFlagSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-_]+$/, "key must be lowercase alphanumeric with - and _"),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["boolean", "string", "number", "json"]).optional(),
  defaultValue: z.string().optional(),
  workspaceId: z.string().optional(),
});

const UpdateFlagSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  defaultValue: z.string().optional(),
});

const OverrideSchema = z.object({
  flag_id: z.string(),
  target_type: z.enum(["user", "workspace"]),
  target_id: z.string().min(1),
  value: z.string(),
});

const AddRuleSchema = z.object({
  flag_id: z.string(),
  name: z.string().optional(),
  type: z.enum(["percentage", "user_list", "attribute", "plan"]),
  config: z.record(z.unknown()),
  value: z.string(),
  priority: z.number().optional(),
});

const CreateExperimentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  flag_id: z.string().optional(),
  variants: z
    .array(z.object({ name: z.string(), weight: z.number() }))
    .optional(),
  trafficPct: z.number().min(0).max(100).optional(),
});

export function makeRouter(sql: Sql) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;
    if (m === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });
    try {
      if (m === "GET" && p === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({
            ok: true,
            service: "microservice-flags",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-flags",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
        }
      }
      if (m === "POST" && p === "/flags") {
        const parsed = await parseBody(req, CreateFlagSchema);
        if ("error" in parsed) return parsed.error;
        return json(await createFlag(sql, parsed.data), 201);
      }
      if (m === "GET" && p === "/flags") {
        const items = await listFlags(
          sql,
          url.searchParams.get("workspace_id") ?? undefined,
        );
        return json({ data: items, count: items.length });
      }
      if (
        m === "GET" &&
        p.match(/^\/flags\/[^/]+$/) &&
        !p.includes("evaluate")
      ) {
        const id = p.split("/")[2];
        const f = await getFlag(sql, id);
        return f ? json(f) : json({ error: "Not found" }, 404);
      }
      if (m === "PATCH" && p.match(/^\/flags\/[^/]+$/)) {
        const id = p.split("/")[2];
        const parsed = await parseBody(req, UpdateFlagSchema);
        if ("error" in parsed) return parsed.error;
        const f = await updateFlag(sql, id, parsed.data);
        return f ? json(f) : json({ error: "Not found" }, 404);
      }
      if (m === "DELETE" && p.match(/^\/flags\/[^/]+$/)) {
        return json({ deleted: await deleteFlag(sql, p.split("/")[2]) });
      }
      // Evaluate
      if (m === "GET" && p === "/flags/evaluate") {
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "key required" }, 400);
        const ctx = {
          userId: url.searchParams.get("user_id") ?? undefined,
          workspaceId: url.searchParams.get("workspace_id") ?? undefined,
        };
        return json(await evaluateFlag(sql, key, ctx));
      }
      if (m === "GET" && p === "/flags/evaluate-all") {
        const wsId = url.searchParams.get("workspace_id") ?? undefined;
        const ctx = {
          userId: url.searchParams.get("user_id") ?? undefined,
          workspaceId: wsId,
        };
        return json(await evaluateAllFlags(sql, wsId, ctx));
      }
      // Overrides
      if (m === "POST" && p === "/flags/overrides") {
        const parsed = await parseBody(req, OverrideSchema);
        if ("error" in parsed) return parsed.error;
        const { flag_id, target_type, target_id, value } = parsed.data;
        await setOverride(sql, flag_id, target_type, target_id, value);
        return json({ ok: true });
      }
      // Rules
      if (m === "POST" && p === "/flags/rules") {
        const parsed = await parseBody(req, AddRuleSchema);
        if ("error" in parsed) return parsed.error;
        const { flag_id, ...data } = parsed.data;
        await addRule(sql, flag_id, data);
        return json({ ok: true }, 201);
      }
      // Experiments
      if (m === "POST" && p === "/flags/experiments") {
        const parsed = await parseBody(req, CreateExperimentSchema);
        if ("error" in parsed) return parsed.error;
        return json(await createExperiment(sql, parsed.data), 201);
      }
      if (m === "GET" && p === "/flags/experiments") {
        const items = await listExperiments(sql);
        return json({ data: items, count: items.length });
      }
      if (m === "PATCH" && p.match(/^\/flags\/experiments\/[^/]+\/status$/)) {
        const id = p.split("/")[3];
        const { status } = await req.json();
        await updateExperimentStatus(sql, id, status);
        return json({ ok: true });
      }
      if (m === "GET" && p.match(/^\/flags\/experiments\/[^/]+\/assign$/)) {
        const id = p.split("/")[3];
        const userId = url.searchParams.get("user_id")!;
        return json({ variant: await assignVariant(sql, id, userId) });
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "Server error" },
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
