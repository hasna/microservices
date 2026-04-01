/**
 * High-level auth flows: register, login, refresh.
 */

import type { Sql } from "postgres";
import { generateAccessToken, generateRefreshToken } from "./jwt.js";
import { verifyPassword } from "./passwords.js";
import { createSession, type Session } from "./sessions.js";
import { createUser, getUserByEmail, type User } from "./users.js";

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  session: Session;
  user: User;
}

export async function register(
  sql: Sql,
  data: { email: string; password: string; name?: string },
  sessionOpts: { ip?: string; user_agent?: string } = {},
): Promise<AuthTokens> {
  const existing = await getUserByEmail(sql, data.email);
  if (existing) throw new Error("Email already in use");

  const user = await createUser(sql, data);
  return createAuthTokens(sql, user, sessionOpts);
}

export async function login(
  sql: Sql,
  data: { email: string; password: string },
  sessionOpts: { ip?: string; user_agent?: string } = {},
): Promise<AuthTokens> {
  const user = await getUserByEmail(sql, data.email);
  if (!user?.password_hash) throw new Error("Invalid email or password");

  const valid = await verifyPassword(data.password, user.password_hash);
  if (!valid) throw new Error("Invalid email or password");

  // Strip password_hash from user object
  const { password_hash: _, ...safeUser } = user;
  return createAuthTokens(sql, safeUser, sessionOpts);
}

export async function refreshTokens(
  _sql: Sql,
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const { verifyJwt } = await import("./jwt.js");
  const payload = await verifyJwt(refreshToken);
  if (payload.type !== "refresh") throw new Error("Invalid token type");

  const access_token = await generateAccessToken(payload.sub, payload.email);
  return { access_token, expires_in: 900 };
}

async function createAuthTokens(
  sql: Sql,
  user: User,
  sessionOpts: { ip?: string; user_agent?: string },
): Promise<AuthTokens> {
  const [session, access_token, refresh_token] = await Promise.all([
    createSession(sql, user.id, sessionOpts),
    generateAccessToken(user.id, user.email),
    generateRefreshToken(user.id, user.email),
  ]);

  return { access_token, refresh_token, expires_in: 900, session, user };
}
