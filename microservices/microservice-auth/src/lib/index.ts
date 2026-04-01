/**
 * @hasna/microservice-auth — embed-first auth library.
 *
 * Usage in your app:
 *   import { migrate, createUser, login, validateSession } from '@hasna/microservice-auth'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const user = await createUser(sql, { email: 'user@example.com', password: 'secret' })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// API keys
export {
  type ApiKey,
  type ApiKeyWithSecret,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  validateApiKey,
} from "./api-keys.js";
// High-level login flow
export { login, refreshTokens, register } from "./auth.js";
// JWT
export {
  generateAccessToken,
  generateRefreshToken,
  type JwtPayload,
  signJwt,
  verifyJwt,
} from "./jwt.js";
// Magic links & tokens
export {
  createEmailVerifyToken,
  createMagicLinkToken,
  createPasswordResetToken,
  verifyEmailToken,
  verifyMagicLinkToken,
  verifyPasswordResetToken,
} from "./magic-links.js";
// Middleware / request validation helper
export {
  type RequestIdentity,
  requireScope,
  validateRequest,
} from "./middleware.js";
// OAuth
export {
  getOAuthAccount,
  listUserOAuthAccounts,
  type OAuthAccount,
  unlinkOAuthAccount,
  upsertOAuthAccount,
} from "./oauth.js";
// Passwords
export { hashPassword, verifyPassword } from "./passwords.js";
// Sessions
export {
  cleanExpiredSessions,
  createSession,
  getSessionByToken,
  listUserSessions,
  revokeAllUserSessions,
  revokeSession,
  type Session,
} from "./sessions.js";
// Users
export {
  countUsers,
  createUser,
  deleteUser,
  getUserByEmail,
  getUserById,
  listUsers,
  type User,
  updateUser,
} from "./users.js";
