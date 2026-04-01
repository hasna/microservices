/**
 * @hasna/microservice-sessions — conversation and message management library.
 *
 * Usage in your app:
 *   import { migrate, createConversation, addMessage } from '@hasna/microservice-sessions'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const conv = await createConversation(sql, { workspace_id: '...', user_id: '...', title: 'My Chat' })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// Context window
export {
  type ContextWindow,
  estimateTokens,
  getContextWindow,
} from "./context.js";
// Conversations
export {
  archiveConversation,
  type Conversation,
  createConversation,
  deleteConversation,
  forkConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "./conversations.js";
// Export
export { exportConversation } from "./export.js";
// Messages
export {
  addMessage,
  deleteMessage,
  getMessage,
  getMessages,
  type Message,
  pinMessage,
  searchMessages,
} from "./messages.js";
