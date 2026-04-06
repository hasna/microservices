import { getDb } from "../db/client.js";
import { set, get, del, exists, clear, keys, getOrSet, touch, type SetOptions } from "../lib/cache.js";
import { createNamespace, listNamespaces, deleteNamespace } from "../lib/namespaces.js";

export async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { method, pathname } = { method: req.method, pathname: url.pathname };
  const sql = getDb();

  try {
    if (method === "GET" && pathname === "/health") {
      return json({ ok: true, service: "microservice-cache" });
    }

    // /cache/{namespace}/{key+} — CRUD operations
    const cacheMatch = pathname.match(/^\/cache\/([^/]+)\/(.+)$/);
    if (cacheMatch) {
      const [, namespace, key] = cacheMatch;
      const decodedKey = decodeURIComponent(key);

      if (method === "GET") {
        const entry = await get(sql, namespace, decodedKey);
        return entry ? json({ key: decodedKey, value: entry.value, hits: entry.hits, ttl_seconds: entry.ttl_seconds }) : json({ error: "Not found" }, 404);
      }
      if (method === "PUT" || method === "POST") {
        const body = await req.json() as { value: string; ttl_seconds?: number };
        await set(sql, namespace, decodedKey, body.value, { ttlSeconds: body.ttl_seconds });
        return json({ ok: true, key: decodedKey });
      }
      if (method === "DELETE") {
        const deleted = await del(sql, namespace, decodedKey);
        return json({ deleted });
      }
      if (method === "PATCH") {
        const body = await req.json() as { ttl_seconds?: number };
        const touched = await touch(sql, namespace, decodedKey, body.ttl_seconds);
        return json({ touched });
      }
    }

    // /cache/{namespace}/keys
    const keysMatch = pathname.match(/^\/cache\/([^/]+)\/keys$/);
    if (keysMatch && method === "GET") {
      const [, namespace] = keysMatch;
      const pattern = url.searchParams.get("pattern") || undefined;
      const k = await keys(sql, namespace, { pattern, limit: Number(url.searchParams.get("limit") ?? 100) });
      return json({ keys: k });
    }

    // /cache/{namespace} — namespace-level ops
    const nsMatch = pathname.match(/^\/cache\/([^/]+)$/);
    if (nsMatch) {
      const [, namespace] = nsMatch;
      if (method === "DELETE") {
        const count = await clear(sql, namespace);
        return json({ cleared: count });
      }
    }

    // /namespaces
    if (method === "POST" && pathname === "/namespaces") {
      const body = await req.json() as { namespace: string; max_entries?: number; default_ttl?: number };
      const ns = await createNamespace(sql, body.namespace, { maxEntries: body.max_entries, defaultTtl: body.default_ttl });
      return json(ns, 201);
    }
    if (method === "GET" && pathname === "/namespaces") {
      return json(await listNamespaces(sql));
    }
    if (method === "DELETE" && nsMatch) {
      const deleted = await deleteNamespace(sql, nsMatch![1]);
      return json({ deleted });
    }

    // /cache/get-or-set/{namespace}/{key+}
    const gosMatch = pathname.match(/^\/cache\/get-or-set\/([^/]+)\/(.+)$/);
    if (gosMatch && method === "POST") {
      const [, namespace, key] = gosMatch;
      const decodedKey = decodeURIComponent(key);
      const body = await req.json() as { factory?: string; ttl_seconds?: number };
      const factory: () => Promise<string> = async () => {
        if (body.factory === "compute") {
          return JSON.stringify({ computed: true, timestamp: Date.now() });
        }
        throw new Error("factory required");
      };
      const result = await getOrSet(sql, namespace, decodedKey, factory, { ttlSeconds: body.ttl_seconds });
      return json({ key: decodedKey, value: result.value, cached: result.cached });
    }

    return json({ error: "Not found" }, 404);
  } catch (err: any) {
    console.error(err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
