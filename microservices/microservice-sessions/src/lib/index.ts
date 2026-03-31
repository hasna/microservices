/**
 * @hasna/microservice-sessions — conversation and message management library.
 *
 * Usage in your app:
 *   import { migrate, createConversation, addMessage } from '@hasna/microservice-sessions'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const conv = await createConversation(sql, { workspace_id: '...', user_id: '...', title: 'My Chat' })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Conversations
export {
  createConversation,
  getConversation,
  listConversations,
  updateConversation,
  deleteConversation,
  archiveConversation,
  forkConversation,
  type Conversation,
} from "./conversations.js";

// Messages
export {
  addMessage,
  getMessages,
  getMessage,
  deleteMessage,
  pinMessage,
  searchMessages,
  type Message,
} from "./messages.js";

// Context window
export {
  getContextWindow,
  estimateTokens,
  type ContextWindow,
} from "./context.js";

// Export
export { exportConversation } from "./export.js";
