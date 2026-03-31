/**
 * @hasna/microservice-llm — LLM gateway library.
 *
 * Usage in your app:
 *   import { migrate, chat, getWorkspaceUsage } from '@hasna/microservice-llm'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const response = await chat(sql, { workspaceId: '...', messages: [...] })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Providers
export {
  chatOpenAI,
  chatAnthropic,
  chatGroq,
  getProvider,
  getAvailableModels,
  callProvider,
  type Message,
  type ChatResponse,
  type ProviderName,
  type ProviderConfig,
} from "./providers.js";

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

// Usage
export {
  getWorkspaceUsage,
  type WorkspaceUsage,
  type ModelUsage,
} from "./usage.js";
