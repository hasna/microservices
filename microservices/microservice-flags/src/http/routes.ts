import type { Sql } from "postgres";
import { createFlag, getFlag, listFlags, updateFlag, deleteFlag, setOverride, addRule } from "../lib/flags.js";
import { evaluateFlag, evaluateAllFlags } from "../lib/evaluate.js";
import { createExperiment, updateExperimentStatus, assignVariant, listExperiments } from "../lib/experiments.js";

export function makeRouter(sql: Sql) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url); const p = url.pathname; const m = req.method;
    try {
      if (m === "GET" && p === "/health") return json({ ok: true, service: "microservice-flags" });
      if (m === "POST" && p === "/flags") return json(await createFlag(sql, await req.json()), 201);
      if (m === "GET" && p === "/flags") return json(await listFlags(sql, url.searchParams.get("workspace_id") ?? undefined));
      if (m === "GET" && p.match(/^\/flags\/[^/]+$/) && !p.includes("evaluate")) {
        const id = p.split("/")[2]; const f = await getFlag(sql, id); return f ? json(f) : json({ error: "Not found" }, 404);
      }
      if (m === "PATCH" && p.match(/^\/flags\/[^/]+$/)) {
        const id = p.split("/")[2]; const f = await updateFlag(sql, id, await req.json()); return f ? json(f) : json({ error: "Not found" }, 404);
      }
      if (m === "DELETE" && p.match(/^\/flags\/[^/]+$/)) {
        return json({ deleted: await deleteFlag(sql, p.split("/")[2]) });
      }
      // Evaluate
      if (m === "GET" && p === "/flags/evaluate") {
        const key = url.searchParams.get("key"); if (!key) return json({ error: "key required" }, 400);
        const ctx = { userId: url.searchParams.get("user_id") ?? undefined, workspaceId: url.searchParams.get("workspace_id") ?? undefined };
        return json(await evaluateFlag(sql, key, ctx));
      }
      if (m === "GET" && p === "/flags/evaluate-all") {
        const wsId = url.searchParams.get("workspace_id") ?? undefined;
        const ctx = { userId: url.searchParams.get("user_id") ?? undefined, workspaceId: wsId };
        return json(await evaluateAllFlags(sql, wsId, ctx));
      }
      // Overrides
      if (m === "POST" && p === "/flags/overrides") {
        const { flag_id, target_type, target_id, value } = await req.json();
        await setOverride(sql, flag_id, target_type, target_id, value); return json({ ok: true });
      }
      // Rules
      if (m === "POST" && p === "/flags/rules") {
        const { flag_id, ...data } = await req.json(); await addRule(sql, flag_id, data); return json({ ok: true }, 201);
      }
      // Experiments
      if (m === "POST" && p === "/flags/experiments") return json(await createExperiment(sql, await req.json()), 201);
      if (m === "GET" && p === "/flags/experiments") return json(await listExperiments(sql));
      if (m === "PATCH" && p.match(/^\/flags\/experiments\/[^/]+\/status$/)) {
        const id = p.split("/")[3]; const { status } = await req.json(); await updateExperimentStatus(sql, id, status); return json({ ok: true });
      }
      if (m === "GET" && p.match(/^\/flags\/experiments\/[^/]+\/assign$/)) {
        const id = p.split("/")[3]; const userId = url.searchParams.get("user_id")!;
        return json({ variant: await assignVariant(sql, id, userId) });
      }
      return json({ error: "Not found" }, 404);
    } catch (e) { return json({ error: e instanceof Error ? e.message : "Server error" }, 500); }
  };
}

function json(d: unknown, s = 200): Response { return new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } }); }
