/**
 * HTTP route handlers for microservice-NAME.
 *
 * Pattern: match method + pathname, call core lib, return JSON.
 */

import { getDb } from "../db/client.js";

export async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { method, pathname } = { method: req.method, pathname: url.pathname };
  const sql = getDb();

  try {
    // Health check
    if (method === "GET" && pathname === "/health") {
      return json({ ok: true, service: "microservice-NAME" });
    }

    // ADD YOUR ROUTES HERE
    // if (method === "GET" && pathname === "/name/records") { ... }
    // if (method === "POST" && pathname === "/name/records") { ... }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Internal server error" }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
