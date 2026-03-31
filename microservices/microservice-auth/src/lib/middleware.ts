/**
 * validateRequest — resolve the caller's identity from a request.
 *
 * Accepts:
 *   - Bearer <session-token>   → type: 'session'
 *   - Bearer <jwt-access-token> → type: 'jwt'
 *   - Bearer hsk_<api-key>     → type: 'api_key'
 *
 * Usage in your app:
 *   import { validateRequest } from '@hasna/microservice-auth'
 *   const identity = await validateRequest(req, sql)
 *   if (!identity) return Response.json({ error: 'Unauthorized' }, { status: 401 })
 */

import type { Sql } from "postgres";
import { getSessionByToken } from "./sessions.js";
import { verifyJwt } from "./jwt.js";
import { validateApiKey } from "./api-keys.js";

export interface RequestIdentity {
  userId: string;
  type: "session" | "jwt" | "api_key";
  scopes?: string[];
  sessionToken?: string;
}

export async function validateRequest(
  req: Request,
  sql: Sql
): Promise<RequestIdentity | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);

  // API key (prefix: hsk_)
  if (token.startsWith("hsk_")) {
    const result = await validateApiKey(sql, token);
    if (!result) return null;
    return { userId: result.userId, type: "api_key", scopes: result.scopes };
  }

  // Session token (opaque hex string, not a JWT)
  if (!token.includes(".")) {
    const session = await getSessionByToken(sql, token);
    if (!session) return null;
    return { userId: session.user_id, type: "session", sessionToken: token };
  }

  // JWT
  try {
    const payload = await verifyJwt(token);
    if (payload.type !== "access") return null;
    return { userId: payload.sub, type: "jwt" };
  } catch {
    return null;
  }
}

/**
 * requireScope — check if an API key identity has a required scope.
 */
export function requireScope(identity: RequestIdentity, scope: string): boolean {
  if (identity.type !== "api_key") return true; // sessions/JWTs have full access
  return identity.scopes?.includes(scope) ?? false;
}
