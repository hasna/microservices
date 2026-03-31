/**
 * @hasna/microservice-auth — embed-first auth library.
 *
 * Usage in your app:
 *   import { migrate, createUser, login, validateSession } from '@hasna/microservice-auth'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const user = await createUser(sql, { email: 'user@example.com', password: 'secret' })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Users
export {
  createUser,
  getUserById,
  getUserByEmail,
  listUsers,
  updateUser,
  deleteUser,
  countUsers,
  type User,
} from "./users.js";

// Sessions
export {
  createSession,
  getSessionByToken,
  listUserSessions,
  revokeSession,
  revokeAllUserSessions,
  cleanExpiredSessions,
  type Session,
} from "./sessions.js";

// Passwords
export { hashPassword, verifyPassword } from "./passwords.js";

// JWT
export {
  signJwt,
  verifyJwt,
  generateAccessToken,
  generateRefreshToken,
  type JwtPayload,
} from "./jwt.js";

// Magic links & tokens
export {
  createMagicLinkToken,
  verifyMagicLinkToken,
  createEmailVerifyToken,
  verifyEmailToken,
  createPasswordResetToken,
  verifyPasswordResetToken,
} from "./magic-links.js";

// API keys
export {
  createApiKey,
  validateApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKey,
  type ApiKeyWithSecret,
} from "./api-keys.js";

// OAuth
export {
  upsertOAuthAccount,
  getOAuthAccount,
  listUserOAuthAccounts,
  unlinkOAuthAccount,
  type OAuthAccount,
} from "./oauth.js";

// High-level login flow
export { login, register, refreshTokens } from "./auth.js";

// Middleware / request validation helper
export { validateRequest, requireScope, type RequestIdentity } from "./middleware.js";
