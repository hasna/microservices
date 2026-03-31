/**
 * @hasna/microservice-onboarding — onboarding flows and user progress tracking.
 *
 * Usage in your app:
 *   import { migrate, createFlow, startFlow, markStep, getProgress } from '@hasna/microservice-onboarding'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const flow = await createFlow(sql, { name: 'welcome', steps: [...] })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Flows
export {
  createFlow,
  getFlow,
  getFlowByName,
  listFlows,
  updateFlow,
  deleteFlow,
  type Flow,
  type FlowStep,
} from "./flows.js";

// Progress
export {
  startFlow,
  markStep,
  getProgress,
  isComplete,
  resetProgress,
  getUserFlows,
  type Progress,
  type ProgressSummary,
} from "./progress.js";
