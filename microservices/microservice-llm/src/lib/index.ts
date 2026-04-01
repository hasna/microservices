/**
 * @hasna/microservice-llm — LLM gateway library.
 *
 * Usage in your app:
 *   import { migrate, chat, getWorkspaceUsage } from '@hasna/microservice-llm'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const response = await chat(sql, { workspaceId: '...', messages: [...] })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// Costs
export {
  COST_PER_1K_TOKENS,
  calculateCost,
} from "./costs.js";
// Gateway
export {
  chat,
  type GatewayRequest,
  type GatewayResponse,
} from "./gateway.js";
// Providers
export {
  type ChatResponse,
  callProvider,
  chatAnthropic,
  chatGroq,
  chatOpenAI,
  getAvailableModels,
  getProvider,
  type Message,
  type ProviderConfig,
  type ProviderName,
} from "./providers.js";

// Usage
export {
  getWorkspaceUsage,
  type ModelUsage,
  type WorkspaceUsage,
} from "./usage.js";
