/**
 * @hasna/microservice-usage — usage tracking and quota enforcement library.
 *
 * Usage in your app:
 *   import { migrate, track, getUsageSummary, checkQuota } from '@hasna/microservice-usage'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   await track(sql, { workspaceId, metric: 'api.calls', quantity: 1 })
 *   const ok = await checkQuota(sql, workspaceId, 'api.calls', 'month')
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Tracking
export {
  track,
  getPeriodStart,
  type TrackInput,
} from "./track.js";

// Querying
export {
  getUsageSummary,
  checkQuota,
  getQuota,
  setQuota,
  listMetrics,
  isValidPeriod,
  VALID_PERIODS,
  type UsageSummary,
  type Quota,
  type QuotaCheck,
  type Period,
} from "./query.js";
