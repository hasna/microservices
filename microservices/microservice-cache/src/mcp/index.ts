import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { set, get, del, exists, clear, keys, getOrSet, touch, increment, decrement } from "../lib/cache.js";
import { createNamespace, listNamespaces, deleteNamespace, getNamespace } from "../lib/namespaces.js";
import { setMany, getMany, delMany, touchMany } from "../lib/batch.js";
import { getNamespaceStats, getTopKeys } from "../lib/stats.js";

const server = new Server(
  { name: "microservice-cache", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler("initialize", async () => ({
  protocolVersion: "2024-11-05",
  capabilities: { tools: {} },
  serverInfo: { name: "microservice-cache", version: "0.0.1" },
}));

server.setRequestHandler("listTools", async () => ({
  tools: [
    {
      name: "cache_set",
      description: "Set a cache value with optional TTL",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          key: { type: "string" },
          value: { type: "string" },
          ttl_seconds: { type: "number" },
        },
        required: ["namespace", "key", "value"],
      },
    },
    {
      name: "cache_get",
      description: "Get a cache value",
      inputSchema: {
        type: "object",
        properties: { namespace: { type: "string" }, key: { type: "string" } },
        required: ["namespace", "key"],
      },
    },
    {
      name: "cache_delete",
      description: "Delete a cache entry",
      inputSchema: {
        type: "object",
        properties: { namespace: { type: "string" }, key: { type: "string" } },
        required: ["namespace", "key"],
      },
    },
    {
      name: "cache_exists",
      description: "Check if a cache key exists and is not expired",
      inputSchema: {
        type: "object",
        properties: { namespace: { type: "string" }, key: { type: "string" } },
        required: ["namespace", "key"],
      },
    },
    {
      name: "cache_keys",
      description: "List keys in a namespace",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          pattern: { type: "string" },
          limit: { type: "number" },
        },
        required: ["namespace"],
      },
    },
    {
      name: "cache_clear",
      description: "Clear all entries in a namespace",
      inputSchema: {
        type: "object",
        properties: { namespace: { type: "string" } },
        required: ["namespace"],
      },
    },
    {
      name: "cache_get_or_set",
      description: "Get cached value or compute and cache it",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          key: { type: "string" },
          ttl_seconds: { type: "number" },
        },
        required: ["namespace", "key"],
      },
    },
    {
      name: "cache_set_many",
      description: "Set multiple cache entries in one operation",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                value: { type: "string" },
              },
              required: ["key", "value"],
            },
          },
          ttl_seconds: { type: "number" },
        },
        required: ["namespace", "entries"],
      },
    },
    {
      name: "cache_get_many",
      description: "Get multiple cache entries at once",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          keys: { type: "array", items: { type: "string" } },
        },
        required: ["namespace", "keys"],
      },
    },
    {
      name: "cache_delete_many",
      description: "Delete multiple cache entries at once",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          keys: { type: "array", items: { type: "string" } },
        },
        required: ["namespace", "keys"],
      },
    },
    {
      name: "cache_get_stats",
      description: "Get comprehensive stats for a namespace",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
        },
        required: ["namespace"],
      },
    },
    {
      name: "cache_top_keys",
      description: "Get top N keys by hit count in a namespace",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          limit: { type: "number" },
        },
        required: ["namespace"],
      },
    },
    {
      name: "cache_increment",
      description: "Atomically increment a numeric cache value",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          key: { type: "string" },
          amount: { type: "number" },
        },
        required: ["namespace", "key"],
      },
    },
    {
      name: "cache_decrement",
      description: "Atomically decrement a numeric cache value",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          key: { type: "string" },
          amount: { type: "number" },
        },
        required: ["namespace", "key"],
      },
    },
    {
      name: "cache_touch",
      description: "Refresh TTL on a cache key without returning its value",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          key: { type: "string" },
          ttl_seconds: { type: "number" },
        },
        required: ["namespace", "key"],
      },
    },
    {
      name: "cache_create_namespace",
      description: "Create a new isolated cache namespace",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["name"],
      },
    },
    {
      name: "cache_list_namespaces",
      description: "List all cache namespaces",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "cache_get_namespace",
      description: "Get a namespace config by name",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
    {
      name: "cache_delete_namespace",
      description: "Delete a cache namespace and all its entries",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
    {
      name: "cache_touch_many",
      description: "Refresh TTL on multiple keys without returning values",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          keys: { type: "array", items: { type: "string" } },
        },
        required: ["namespace", "keys"],
      },
    },
    {
      name: "cache_get_global_stats",
      description: "Get aggregate stats across all namespaces — total entries, size, hits, hit rate",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "cache_search_keys",
      description: "Search for keys matching a pattern across all namespaces",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "SQL LIKE pattern (e.g. 'user:%')" },
          limit: { type: "number" },
        },
        required: ["pattern"],
      },
    },
    {
      name: "cache_get_eviction_candidates",
      description: "Find keys that are good candidates for eviction — low hit count and/or expiring soon",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          max_hits: { type: "number" },
          expiring_within_seconds: { type: "number" },
          limit: { type: "number" },
        },
        required: ["namespace"],
      },
    },
    {
      name: "cache_get_key_ttl_info",
      description: "Get detailed TTL and expiry information for a key without affecting its hit count",
      inputSchema: {
        type: "object",
        properties: { namespace: { type: "string" }, key: { type: "string" } },
        required: ["namespace", "key"],
      },
    },
    {
      name: "cache_count",
      description: "Count entries in a namespace without affecting hit counters",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
        },
        required: ["namespace"],
      },
    },
    {
      name: "cache_reset_hits",
      description: "Reset hit counters for keys in a namespace (or a specific key)",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          key: { type: "string" },
        },
        required: ["namespace"],
      },
    },
  ],
}));

server.setRequestHandler("callTool", async ({ name, arguments: args }) => {
  const sql = getDb();
  try {
    switch (name) {
      case "cache_set": {
        await set(sql, args.namespace, args.key, args.value, { ttlSeconds: args.ttl_seconds });
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, key: args.key }) }] };
      }
      case "cache_get": {
        const result = await get(sql, args.namespace, args.key);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      case "cache_delete": {
        const deleted = await del(sql, args.namespace, args.key);
        return { content: [{ type: "text", text: JSON.stringify({ deleted }) }] };
      }
      case "cache_exists": {
        const found = await exists(sql, args.namespace, args.key);
        return { content: [{ type: "text", text: JSON.stringify({ exists: found }) }] };
      }
      case "cache_keys": {
        const k = await keys(sql, args.namespace, { pattern: args.pattern, limit: args.limit });
        return { content: [{ type: "text", text: JSON.stringify({ keys: k }) }] };
      }
      case "cache_clear": {
        const count = await clear(sql, args.namespace);
        return { content: [{ type: "text", text: JSON.stringify({ cleared: count }) }] };
      }
      case "cache_get_or_set": {
        const result = await getOrSet(
          sql, args.namespace, args.key,
          async () => JSON.stringify({ computed: true, timestamp: Date.now() }),
          { ttlSeconds: args.ttl_seconds },
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      case "cache_set_many": {
        const count = await setMany(
          sql, args.namespace,
          args.entries.map((e: { key: string; value: string }) => ({ key: e.key, value: e.value })),
          { ttlSeconds: args.ttl_seconds },
        );
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, count }) }] };
      }
      case "cache_get_many": {
        const result = await getMany(sql, args.namespace, args.keys);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      case "cache_delete_many": {
        const count = await delMany(sql, args.namespace, args.keys);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: count }) }] };
      }
      case "cache_get_stats": {
        const result = await getNamespaceStats(sql, args.namespace);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      case "cache_top_keys": {
        const result = await getTopKeys(sql, args.namespace, args.limit ?? 10);
        return { content: [{ type: "text", text: JSON.stringify({ keys: result }) }] };
      }
      case "cache_increment": {
        const result = await increment(sql, args.namespace, args.key, args.amount ?? 1);
        return { content: [{ type: "text", text: JSON.stringify({ value: result }) }] };
      }
      case "cache_decrement": {
        const result = await decrement(sql, args.namespace, args.key, args.amount ?? 1);
        return { content: [{ type: "text", text: JSON.stringify({ value: result }) }] };
      }
      case "cache_touch": {
        const touched = await touch(sql, args.namespace, args.key, args.ttl_seconds);
        return { content: [{ type: "text", text: JSON.stringify({ touched }) }] };
      }
      case "cache_create_namespace": {
        const result = await createNamespace(sql, args.name, args.description);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      case "cache_list_namespaces": {
        const result = await listNamespaces(sql);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      case "cache_get_namespace": {
        const result = await getNamespace(sql, args.name);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      case "cache_delete_namespace": {
        const result = await deleteNamespace(sql, args.name);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      case "cache_touch_many": {
        const count = await touchMany(sql, args.namespace, args.keys);
        return { content: [{ type: "text", text: JSON.stringify({ touched: count }) }] };
      }
      case "cache_get_global_stats": {
        const [meta] = await sql<{ total_entries: string; total_size: string; total_hits: string; namespace_count: string }[]>`
          SELECT
            COUNT(*)::text as total_entries,
            COALESCE(SUM(LENGTH(value)), 0)::text as total_size,
            COALESCE(SUM(hits), 0)::text as total_hits,
            COUNT(DISTINCT namespace)::text as namespace_count
          FROM cache.entries WHERE expires_at > NOW()`;
        return { content: [{ type: "text", text: JSON.stringify({
          total_entries: parseInt(meta?.total_entries ?? "0", 10),
          total_size_bytes: parseInt(meta?.total_size ?? "0", 10),
          total_hits: parseInt(meta?.total_hits ?? "0", 10),
          namespace_count: parseInt(meta?.namespace_count ?? "0", 10),
          hit_rate_pct: meta?.total_entries && parseInt(meta.total_entries, 10) > 0
            ? Math.round((parseInt(meta.total_hits ?? "0", 10) / (parseInt(meta.total_entries, 10) * 2)) * 10000) / 100
            : 0,
        }) }] };
      }
      case "cache_search_keys": {
        const rows = await sql<{ namespace: string; key: string; hits: number; expires_at: string }[]>`
          SELECT namespace, key, hits, expires_at FROM cache.entries
          WHERE expires_at > NOW() AND key LIKE ${String(args.pattern).replace(/%/g, "") + "%"}
          ORDER BY hits DESC LIMIT ${args.limit ?? 50}`;
        return { content: [{ type: "text", text: JSON.stringify({ pattern: args.pattern, matches: rows }) }] };
      }
      case "cache_get_eviction_candidates": {
        const rows = await sql<{ namespace: string; key: string; hits: number; ttl_seconds: number; expires_at: string }[]>`
          SELECT namespace, key, hits, ttl_seconds, expires_at FROM cache.entries
          WHERE namespace = ${args.namespace}
            AND expires_at > NOW()
            AND hits <= ${args.max_hits ?? 3}
            AND expires_at < NOW() + INTERVAL '${sql.unsafe(`${args.expiring_within_seconds ?? 3600} seconds`)}'
          ORDER BY hits ASC, expires_at ASC
          LIMIT ${args.limit ?? 100}`;
        return { content: [{ type: "text", text: JSON.stringify({ candidates: rows }) }] };
      }
      case "cache_get_key_ttl_info": {
        const [entry] = await sql<{ key: string; ttl_seconds: number; expires_at: string; created_at: string; updated_at: string; hits: number }[]>`
          SELECT key, ttl_seconds, expires_at, created_at, updated_at, hits
          FROM cache.entries
          WHERE namespace = ${args.namespace} AND key = ${args.key} AND expires_at > NOW()`;
        if (!entry) return { content: [{ type: "text", text: JSON.stringify({ found: false, key: args.key }) }] };
        const ttlRemaining = Math.max(0, Math.ceil((new Date(entry.expires_at).getTime() - Date.now()) / 1000));
        return { content: [{ type: "text", text: JSON.stringify({ found: true, key: entry.key, ttl_seconds: entry.ttl_seconds, ttl_remaining_seconds: ttlRemaining, expires_at: entry.expires_at, created_at: entry.created_at, updated_at: entry.updated_at, hits: entry.hits }) }] };
      }
      case "cache_count": {
        const [row] = await sql<{ count: string }[]>`
          SELECT COUNT(*)::text as count FROM cache.entries
          WHERE namespace = ${args.namespace} AND expires_at > NOW()`;
        return { content: [{ type: "text", text: JSON.stringify({ namespace: args.namespace, count: parseInt(row?.count ?? "0", 10) }) }] };
      }
      case "cache_reset_hits": {
        if (args.key) {
          await sql`UPDATE cache.entries SET hits = 0 WHERE namespace = ${args.namespace} AND key = ${args.key} AND expires_at > NOW()`;
          return { content: [{ type: "text", text: JSON.stringify({ namespace: args.namespace, key: args.key, hits_reset: true }) }] };
        } else {
          const r = await sql`UPDATE cache.entries SET hits = 0 WHERE namespace = ${args.namespace} AND expires_at > NOW()`;
          return { content: [{ type: "text", text: JSON.stringify({ namespace: args.namespace, keys_reset: r.count }) }] };
        }
      }
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } finally {
    await sql.end();
  }
});

async function main() {
  const sql = getDb();
  await migrate(sql);
  await sql.end();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
