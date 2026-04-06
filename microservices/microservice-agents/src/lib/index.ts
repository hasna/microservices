export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
export {
  getAgentHealth,
  type HealthReport,
  markStaleAgents,
} from "./health.js";
export {
  type Message,
  markDelivered,
  markRead,
  receiveMessages,
  sendMessage,
} from "./messaging.js";
export {
  type Agent,
  deregisterAgent,
  getAgent,
  getAgentByName,
  heartbeat,
  listAgents,
  registerAgent,
  updateAgent,
} from "./registry.js";
export { findAgentByCapability, routeTask } from "./routing.js";
export {
  claimTask,
  completeTask,
  createTask,
  failTask,
  getTask,
  listTasks,
  type Task,
} from "./tasks.js";
export {
  type AgentTool,
  type RegisterToolInput,
  registerTool,
  deregisterTool,
  getTool,
  getToolByName,
  listToolsForAgent,
  listToolsByTag,
  updateTool,
  activateTool,
  deactivateTool,
  searchTools,
  discoverToolsForCapability,
} from "./tools.js";
