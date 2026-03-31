/**
 * @hasna/microservice-audit — immutable audit log library.
 *
 * Usage in your app:
 *   import { migrate, logEvent, queryEvents } from '@hasna/microservice-audit'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   await logEvent(sql, { action: 'user.login', resourceType: 'user', resourceId: userId })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Events
export {
  logEvent,
  queryEvents,
  countEvents,
  getEvent,
  exportEvents,
  computeChecksum,
  VALID_SEVERITY_LEVELS,
  type AuditEvent,
  type LogEventInput,
  type QueryFilters,
  type SeverityLevel,
} from "./events.js";

// Retention
export {
  getRetentionPolicy,
  setRetentionPolicy,
  applyRetention,
  type RetentionPolicy,
} from "./retention.js";
