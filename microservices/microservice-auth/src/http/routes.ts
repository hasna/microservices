/**
 * Auth HTTP routes.
 */

import { z } from "zod";
import type { Sql } from "postgres";
import { register, login, refreshTokens } from "../lib/auth.js";
import { getSessionByToken, revokeSession, createSession } from "../lib/sessions.js";
import { verifyJwt, generateAccessToken, generateRefreshToken } from "../lib/jwt.js";
import { getUserById, getUserByEmail, createUser, updateUser } from "../lib/users.js";
import {
  createMagicLinkToken,
  verifyMagicLinkToken,
  createPasswordResetToken,
  verifyPasswordResetToken,
} from "../lib/magic-links.js";
import { hashPassword } from "../lib/passwords.js";
import { createApiKey, listApiKeys, revokeApiKey, validateApiKey } from "../lib/api-keys.js";
import { upsertOAuthAccount } from "../lib/oauth.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().optional(),
});
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const MagicLinkSchema = z.object({ email: z.string().email() });
const RefreshSchema = z.object({ refresh_token: z.string().min(1) });
const ApiKeySchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  expires_at: z.string().optional(),
});
const PasswordResetRequestSchema = z.object({ email: z.string().email() });
const PasswordResetConfirmSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});
const MagicLinkVerifySchema = z.object({ token: z.string().min(1) });

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
      if (method === "GET" && path === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({ ok: true, service: "microservice-auth", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-auth", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // POST /auth/register
      if (method === "POST" && path === "/auth/register") {
        const parsed = await parseBody(req, RegisterSchema);
        if ("error" in parsed) return parsed.error;
        const result = await register(sql, parsed.data, reqOpts(req));
        return json(result, 201);
      }

      // POST /auth/login
      if (method === "POST" && path === "/auth/login") {
        const parsed = await parseBody(req, LoginSchema);
        if ("error" in parsed) return parsed.error;
        const result = await login(sql, parsed.data, reqOpts(req));
        return json(result);
      }

      // POST /auth/logout
      if (method === "POST" && path === "/auth/logout") {
        const token = bearerToken(req);
        if (!token) return apiError("UNAUTHORIZED", "Unauthorized", undefined, 401);
        await revokeSession(sql, token);
        return json({ ok: true });
      }

      // GET /auth/session
      if (method === "GET" && path === "/auth/session") {
        const token = bearerToken(req);
        if (!token) return apiError("UNAUTHORIZED", "Unauthorized", undefined, 401);
        const session = await getSessionByToken(sql, token);
        if (!session) return apiError("UNAUTHORIZED", "Invalid or expired session", undefined, 401);
        const user = await getUserById(sql, session.user_id);
        return json({ session, user });
      }

      // POST /auth/refresh
      if (method === "POST" && path === "/auth/refresh") {
        const parsed = await parseBody(req, RefreshSchema);
        if ("error" in parsed) return parsed.error;
        const result = await refreshTokens(sql, parsed.data.refresh_token);
        return json(result);
      }

      // POST /auth/magic-link
      if (method === "POST" && path === "/auth/magic-link") {
        const parsed = await parseBody(req, MagicLinkSchema);
        if ("error" in parsed) return parsed.error;
        const { getUserByEmail, createUser } = await import("../lib/users.js");
        let user = await getUserByEmail(sql, parsed.data.email);
        if (!user) user = await createUser(sql, { email: parsed.data.email });
        const token = await createMagicLinkToken(sql, user.id);
        // In production, send this via email. Return for dev/testing.
        return json({ token, message: "Magic link token generated" });
      }

      // POST /auth/magic-link/verify
      if (method === "POST" && path === "/auth/magic-link/verify") {
        const parsed = await parseBody(req, MagicLinkVerifySchema);
        if ("error" in parsed) return parsed.error;
        const result = await verifyMagicLinkToken(sql, parsed.data.token);
        if (!result) return apiError("UNAUTHORIZED", "Invalid or expired token", undefined, 401);
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
        const parsed = await parseBody(req, PasswordResetRequestSchema);
        if ("error" in parsed) return parsed.error;
        const { getUserByEmail } = await import("../lib/users.js");
        const user = await getUserByEmail(sql, parsed.data.email);
        if (!user) return json({ ok: true }); // Don't leak existence
        const token = await createPasswordResetToken(sql, user.id);
        return json({ token, message: "Password reset token generated" });
      }

      // POST /auth/password-reset/confirm
      if (method === "POST" && path === "/auth/password-reset/confirm") {
        const parsed = await parseBody(req, PasswordResetConfirmSchema);
        if ("error" in parsed) return parsed.error;
        const userId = await verifyPasswordResetToken(sql, parsed.data.token);
        if (!userId) return apiError("UNAUTHORIZED", "Invalid or expired token", undefined, 401);
        const hash = await hashPassword(parsed.data.password);
        await sql`UPDATE auth.users SET password_hash = ${hash}, updated_at = NOW() WHERE id = ${userId}`;
        return json({ ok: true });
      }

      // GET /auth/api-keys
      if (method === "GET" && path === "/auth/api-keys") {
        const userId = await requireAuth(req, sql);
        if (!userId) return apiError("UNAUTHORIZED", "Unauthorized", undefined, 401);
        const keys = await listApiKeys(sql, userId);
        return json({ data: keys, count: keys.length });
      }

      // POST /auth/api-keys
      if (method === "POST" && path === "/auth/api-keys") {
        const userId = await requireAuth(req, sql);
        if (!userId) return apiError("UNAUTHORIZED", "Unauthorized", undefined, 401);
        const parsed = await parseBody(req, ApiKeySchema);
        if ("error" in parsed) return parsed.error;
        const key = await createApiKey(sql, userId, {
          name: parsed.data.name,
          scopes: parsed.data.scopes,
          expiresAt: parsed.data.expires_at ? new Date(parsed.data.expires_at) : undefined,
        });
        return json(key, 201);
      }

      // DELETE /auth/api-keys/:id
      if (method === "DELETE" && path.startsWith("/auth/api-keys/")) {
        const userId = await requireAuth(req, sql);
        if (!userId) return apiError("UNAUTHORIZED", "Unauthorized", undefined, 401);
        const id = path.split("/").pop()!;
        const ok = await revokeApiKey(sql, id, userId);
        return json({ ok });
      }

      // GET /auth/me
      if (method === "GET" && path === "/auth/me") {
        const userId = await requireAuth(req, sql);
        if (!userId) return apiError("UNAUTHORIZED", "Unauthorized", undefined, 401);
        const user = await getUserById(sql, userId);
        return user ? json(user) : apiError("NOT_FOUND", "User not found", undefined, 404);
      }

      // PATCH /auth/me
      if (method === "PATCH" && path === "/auth/me") {
        const userId = await requireAuth(req, sql);
        if (!userId) return apiError("UNAUTHORIZED", "Unauthorized", undefined, 401);
        const UpdateMeSchema = z.object({ name: z.string().optional(), avatar_url: z.string().url().optional() });
        const parsed = await parseBody(req, UpdateMeSchema);
        if ("error" in parsed) return parsed.error;
        const user = await updateUser(sql, userId, parsed.data);
        return user ? json(user) : apiError("NOT_FOUND", "User not found", undefined, 404);
      }

      // POST /auth/change-password
      if (method === "POST" && path === "/auth/change-password") {
        const userId = await requireAuth(req, sql);
        if (!userId) return apiError("UNAUTHORIZED", "Unauthorized", undefined, 401);
        const ChangePasswordSchema = z.object({ current_password: z.string().min(1), new_password: z.string().min(8, "Password must be at least 8 characters") });
        const parsed = await parseBody(req, ChangePasswordSchema);
        if ("error" in parsed) return parsed.error;
        const { getUserByEmail, getUserById: getById } = await import("../lib/users.js");
        const user = await getById(sql, userId) as any;
        if (!user) return apiError("NOT_FOUND", "User not found", undefined, 404);
        const full = await sql<[{ password_hash: string | null }]>`SELECT password_hash FROM auth.users WHERE id = ${userId}`;
        if (!full[0]?.password_hash) return apiError("BAD_REQUEST", "Account uses passwordless auth", undefined, 400);
        const { verifyPassword, hashPassword } = await import("../lib/passwords.js");
        const valid = await verifyPassword(parsed.data.current_password, full[0].password_hash);
        if (!valid) return apiError("UNAUTHORIZED", "Current password is incorrect", undefined, 401);
        const hash = await hashPassword(parsed.data.new_password);
        await sql`UPDATE auth.users SET password_hash = ${hash}, updated_at = NOW() WHERE id = ${userId}`;
        return json({ ok: true });
      }

      // GET /auth/oauth/:provider — redirect to provider authorization URL
      if (method === "GET" && path.match(/^\/auth\/oauth\/[^/]+$/) && !path.endsWith("/callback")) {
        const provider = path.split("/")[3];
        return handleOAuthRedirect(req, provider);
      }

      // GET /auth/oauth/:provider/callback — exchange code for tokens
      if (method === "GET" && path.match(/^\/auth\/oauth\/[^/]+\/callback$/)) {
        const provider = path.split("/")[3];
        return handleOAuthCallback(req, sql, provider);
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
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

function getOAuthRedirectUri(provider: string): string {
  const port = process.env.AUTH_PORT ?? "3000";
  const base = process.env.OAUTH_REDIRECT_URI?.replace(":provider", provider)
    ?? `http://localhost:${port}/auth/oauth/${provider}/callback`;
  return base;
}

function handleOAuthRedirect(req: Request, provider: string): Response {
  const redirectUri = getOAuthRedirectUri(provider);
  const state = crypto.randomUUID();

  if (provider === "github") {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) return apiError("NOT_CONFIGURED", "OAuth provider not configured");
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "user:email");
    url.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url.toString() } });
  }

  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return apiError("NOT_CONFIGURED", "OAuth provider not configured");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url.toString() } });
  }

  return apiError("NOT_CONFIGURED", "OAuth provider not configured");
}

async function handleOAuthCallback(req: Request, sql: Sql, provider: string): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return apiError("BAD_REQUEST", "Missing code parameter");

  const redirectUri = getOAuthRedirectUri(provider);

  let providerUserId: string;
  let email: string;
  let name: string | undefined;
  let avatarUrl: string | undefined;
  let oauthAccessToken: string;
  let oauthRefreshToken: string | undefined;
  let oauthExpiresAt: Date | undefined;

  if (provider === "github") {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) return apiError("NOT_CONFIGURED", "OAuth provider not configured");

    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) return apiError("OAUTH_ERROR", tokenData.error ?? "Failed to get access token");
    oauthAccessToken = tokenData.access_token;

    // Fetch user info
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${oauthAccessToken}`, "User-Agent": "microservice-auth" },
    });
    const githubUser = await userRes.json() as { id: number; login: string; name?: string; avatar_url?: string; email?: string | null };

    // Fetch emails if primary email not on user object
    let primaryEmail = githubUser.email;
    if (!primaryEmail) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${oauthAccessToken}`, "User-Agent": "microservice-auth" },
      });
      const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primary = emails.find(e => e.primary && e.verified) ?? emails.find(e => e.verified) ?? emails[0];
      primaryEmail = primary?.email ?? null;
    }

    if (!primaryEmail) return apiError("OAUTH_ERROR", "Could not retrieve email from GitHub account");

    providerUserId = String(githubUser.id);
    email = primaryEmail;
    name = githubUser.name ?? githubUser.login;
    avatarUrl = githubUser.avatar_url;
  } else if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return apiError("NOT_CONFIGURED", "OAuth provider not configured");

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokenData = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!tokenData.access_token) return apiError("OAUTH_ERROR", tokenData.error ?? "Failed to get access token");
    oauthAccessToken = tokenData.access_token;
    oauthRefreshToken = tokenData.refresh_token;
    if (tokenData.expires_in) {
      oauthExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    }

    // Fetch user info
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${oauthAccessToken}` },
    });
    const googleUser = await userRes.json() as { sub: string; email: string; name?: string; picture?: string };

    if (!googleUser.email) return apiError("OAUTH_ERROR", "Could not retrieve email from Google account");

    providerUserId = googleUser.sub;
    email = googleUser.email;
    name = googleUser.name;
    avatarUrl = googleUser.picture;
  } else {
    return apiError("NOT_CONFIGURED", "OAuth provider not configured");
  }

  // Find or create user by email
  const existingUser = await getUserByEmail(sql, email);
  const resolvedUser = existingUser ?? (await createUser(sql, { email, name }));

  // Upsert oauth account
  await upsertOAuthAccount(sql, {
    userId: resolvedUser.id,
    provider,
    providerId: providerUserId,
    accessToken: oauthAccessToken,
    refreshToken: oauthRefreshToken,
    expiresAt: oauthExpiresAt,
  });

  // Create session + tokens
  const [session, access_token, refresh_token] = await Promise.all([
    createSession(sql, resolvedUser.id, reqOpts(req)),
    generateAccessToken(resolvedUser.id, resolvedUser.email),
    generateRefreshToken(resolvedUser.id, resolvedUser.email),
  ]);

  // Strip password_hash from user if present
  const { password_hash: _ph, ...safeUser } = resolvedUser as typeof resolvedUser & { password_hash?: string | null };

  return json({ access_token, refresh_token, expires_in: 900, session, user: safeUser });
}
