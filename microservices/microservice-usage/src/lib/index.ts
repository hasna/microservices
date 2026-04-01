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

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// Querying
export {
  checkQuota,
  getQuota,
  getUsageSummary,
  isValidPeriod,
  listMetrics,
  type Period,
  type Quota,
  type QuotaCheck,
  setQuota,
  type UsageSummary,
  VALID_PERIODS,
} from "./query.js";
// Tracking
export {
  getPeriodStart,
  type TrackInput,
  track,
} from "./track.js";
