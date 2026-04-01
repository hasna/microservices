/**
 * microservice-waitlist — core library.
 *
 * Import this in your app to use waitlist functionality directly
 * against your existing PostgreSQL connection.
 *
 * Example:
 *   import { migrate, joinWaitlist, createCampaign } from '@hasna/microservice-waitlist'
 *   await migrate(sql)
 *   const campaign = await createCampaign(sql, { name: 'beta' })
 *   const entry = await joinWaitlist(sql, { campaignId: campaign.id, email: 'user@example.com' })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
export type {
  Campaign,
  CreateCampaignInput,
  UpdateCampaignInput,
} from "./campaigns.js";
export {
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
} from "./campaigns.js";
export type { Entry, JoinWaitlistInput } from "./entries.js";
export {
  calculatePriorityScore,
  getEntry,
  getEntryByEmail,
  getPosition,
  inviteBatch,
  isValidEmail,
  joinWaitlist,
  listEntries,
  markJoined,
  removeEntry,
  updateScore,
} from "./entries.js";
export type { WaitlistStats } from "./stats.js";
export { getWaitlistStats } from "./stats.js";
