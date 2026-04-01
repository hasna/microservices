/**
 * @hasna/microservice-audit — immutable audit log library.
 *
 * Usage in your app:
 *   import { migrate, logEvent, queryEvents } from '@hasna/microservice-audit'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   await logEvent(sql, { action: 'user.login', resourceType: 'user', resourceId: userId })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";

// Events
export {
  type AuditEvent,
  computeChecksum,
  countEvents,
  exportEvents,
  getEvent,
  type LogEventInput,
  logEvent,
  type QueryFilters,
  queryEvents,
  type SeverityLevel,
  VALID_SEVERITY_LEVELS,
} from "./events.js";

// Retention
export {
  applyRetention,
  getRetentionPolicy,
  type RetentionPolicy,
  setRetentionPolicy,
} from "./retention.js";

// Stats
export {
  type AuditStats,
  getAuditStats,
} from "./stats.js";
