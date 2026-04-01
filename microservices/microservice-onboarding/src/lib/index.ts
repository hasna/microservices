/**
 * @hasna/microservice-onboarding — onboarding flows and user progress tracking.
 *
 * Usage in your app:
 *   import { migrate, createFlow, startFlow, markStep, getProgress } from '@hasna/microservice-onboarding'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const flow = await createFlow(sql, { name: 'welcome', steps: [...] })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";

// Flows
export {
  createFlow,
  deleteFlow,
  type Flow,
  type FlowStep,
  getFlow,
  getFlowByName,
  listFlows,
  updateFlow,
} from "./flows.js";

// Progress
export {
  getProgress,
  getUserFlows,
  isComplete,
  markStep,
  type Progress,
  type ProgressSummary,
  resetProgress,
  startFlow,
} from "./progress.js";
