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

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

export {
  joinWaitlist,
  getEntry,
  getEntryByEmail,
  getPosition,
  updateScore,
  inviteBatch,
  markJoined,
  removeEntry,
  listEntries,
  isValidEmail,
  calculatePriorityScore,
} from "./entries.js";

export type { Entry, JoinWaitlistInput } from "./entries.js";

export {
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
} from "./campaigns.js";

export type { Campaign, CreateCampaignInput, UpdateCampaignInput } from "./campaigns.js";

export { getWaitlistStats } from "./stats.js";
export type { WaitlistStats } from "./stats.js";
