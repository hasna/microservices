/**
 * Auth HTTP routes.
 */

import type { Sql } from "postgres";
import { register, login, refreshTokens } from "../lib/auth.js";
import { getSessionByToken, revokeSession } from "../lib/sessions.js";
import { verifyJwt } from "../lib/jwt.js";
import { getUserById } from "../lib/users.js";
import {
  createMagicLinkToken,
  verifyMagicLinkToken,
  createPasswordResetToken,
  verifyPasswordResetToken,
} from "../lib/magic-links.js";
import { hashPassword } from "../lib/passwords.js";
import { createApiKey, listApiKeys, revokeApiKey, validateApiKey } from "../lib/api-keys.js";

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      if (method === "GET" && path === "/health") {
        return json({ ok: true, service: "microservice-auth" });
      }

      // POST /auth/register
      if (method === "POST" && path === "/auth/register") {
        const { email, password, name } = await req.json();
        if (!email || !password) return json({ error: "email and password required" }, 400);
        const result = await register(sql, { email, password, name }, reqOpts(req));
        return json(result, 201);
      }

      // POST /auth/login
      if (method === "POST" && path === "/auth/login") {
        const { email, password } = await req.json();
        if (!email || !password) return json({ error: "email and password required" }, 400);
        const result = await login(sql, { email, password }, reqOpts(req));
        return json(result);
      }

      // POST /auth/logout
      if (method === "POST" && path === "/auth/logout") {
        const token = bearerToken(req);
        if (!token) return json({ error: "Unauthorized" }, 401);
        await revokeSession(sql, token);
        return json({ ok: true });
      }

      // GET /auth/session
      if (method === "GET" && path === "/auth/session") {
        const token = bearerToken(req);
        if (!token) return json({ error: "Unauthorized" }, 401);
        const session = await getSessionByToken(sql, token);
        if (!session) return json({ error: "Invalid or expired session" }, 401);
        const user = await getUserById(sql, session.user_id);
        return json({ session, user });
      }

      // POST /auth/refresh
      if (method === "POST" && path === "/auth/refresh") {
        const { refresh_token } = await req.json();
        if (!refresh_token) return json({ error: "refresh_token required" }, 400);
        const result = await refreshTokens(sql, refresh_token);
        return json(result);
      }

      // POST /auth/magic-link
      if (method === "POST" && path === "/auth/magic-link") {
        const { email } = await req.json();
        if (!email) return json({ error: "email required" }, 400);
        const { getUserByEmail, createUser } = await import("../lib/users.js");
        let user = await getUserByEmail(sql, email);
        if (!user) user = await createUser(sql, { email });
        const token = await createMagicLinkToken(sql, user.id);
        // In production, send this via email. Return for dev/testing.
        return json({ token, message: "Magic link token generated" });
      }

      // POST /auth/magic-link/verify
      if (method === "POST" && path === "/auth/magic-link/verify") {
        const { token } = await req.json();
        if (!token) return json({ error: "token required" }, 400);
        const result = await verifyMagicLinkToken(sql, token);
        if (!result) return json({ error: "Invalid or expired token" }, 401);
        const { createSession } = await import("../lib/sessions.js");
        const { generateAccessToken, generateRefreshToken } = await import("../lib/jwt.js");
        const user = await getUserById(sql, result.userId);
        const [session, access_token, refresh_token] = await Promise.all([
          createSession(sql, result.userId, reqOpts(req)),
          generateAccessToken(result.userId, user?.email ?? ""),
          generateRefreshToken(result.userId, user?.email ?? ""),
        ]);
        return json({ access_token, refresh_token, expires_in: 900, session, user });
      }

      // POST /auth/password-reset/request
      if (method === "POST" && path === "/auth/password-reset/request") {
        const { email } = await req.json();
        if (!email) return json({ error: "email required" }, 400);
        const { getUserByEmail } = await import("../lib/users.js");
        const user = await getUserByEmail(sql, email);
        if (!user) return json({ ok: true }); // Don't leak existence
        const token = await createPasswordResetToken(sql, user.id);
        return json({ token, message: "Password reset token generated" });
      }

      // POST /auth/password-reset/confirm
      if (method === "POST" && path === "/auth/password-reset/confirm") {
        const { token, password } = await req.json();
        if (!token || !password) return json({ error: "token and password required" }, 400);
        const userId = await verifyPasswordResetToken(sql, token);
        if (!userId) return json({ error: "Invalid or expired token" }, 401);
        const hash = await hashPassword(password);
        await sql`UPDATE auth.users SET password_hash = ${hash}, updated_at = NOW() WHERE id = ${userId}`;
        return json({ ok: true });
      }

      // GET /auth/api-keys
      if (method === "GET" && path === "/auth/api-keys") {
        const userId = await requireAuth(req, sql);
        if (!userId) return json({ error: "Unauthorized" }, 401);
        const keys = await listApiKeys(sql, userId);
        return json({ keys });
      }

      // POST /auth/api-keys
      if (method === "POST" && path === "/auth/api-keys") {
        const userId = await requireAuth(req, sql);
        if (!userId) return json({ error: "Unauthorized" }, 401);
        const { name, scopes, expires_at } = await req.json();
        if (!name) return json({ error: "name required" }, 400);
        const key = await createApiKey(sql, userId, {
          name,
          scopes,
          expiresAt: expires_at ? new Date(expires_at) : undefined,
        });
        return json(key, 201);
      }

      // DELETE /auth/api-keys/:id
      if (method === "DELETE" && path.startsWith("/auth/api-keys/")) {
        const userId = await requireAuth(req, sql);
        if (!userId) return json({ error: "Unauthorized" }, 401);
        const id = path.split("/").pop()!;
        const ok = await revokeApiKey(sql, id, userId);
        return json({ ok });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      const status = msg.includes("Invalid") || msg.includes("expired") ? 401 : 500;
      return json({ error: msg }, status);
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function reqOpts(req: Request) {
  return {
    ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined,
    user_agent: req.headers.get("user-agent") ?? undefined,
  };
}

async function requireAuth(req: Request, sql: Sql): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;

  // Try session token first
  const session = await getSessionByToken(sql, token);
  if (session) return session.user_id;

  // Try JWT
  try {
    const payload = await verifyJwt(token);
    return payload.sub;
  } catch {
    return null;
  }
}
