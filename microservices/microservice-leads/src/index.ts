/**
 * microservice-leads — Lead generation, storage, scoring, and data enrichment microservice
 */

export {
  createLead,
  getLead,
  listLeads,
  updateLead,
  deleteLead,
  searchLeads,
  findByEmail,
  bulkImportLeads,
  exportLeads,
  addActivity,
  getActivities,
  getLeadTimeline,
  getLeadStats,
  getPipeline,
  deduplicateLeads,
  mergeLeads,
  type Lead,
  type CreateLeadInput,
  type UpdateLeadInput,
  type ListLeadsOptions,
  type LeadActivity,
  type LeadStats,
  type PipelineStage,
  type BulkImportResult,
  type DuplicatePair,
} from "./db/leads.js";

export {
  createList,
  getList,
  listLists,
  deleteList,
  addToList,
  removeFromList,
  getListMembers,
  getSmartListMembers,
  type LeadList,
  type CreateListInput,
} from "./db/lists.js";

export {
  enrichLead,
  enrichFromEmail,
  enrichFromDomain,
  getCachedEnrichment,
  cacheEnrichment,
  bulkEnrich,
  type EnrichmentData,
  type CachedEnrichment,
} from "./lib/enrichment.js";

export {
  scoreLead,
  autoScoreAll,
  getScoreDistribution,
  type ScoreResult,
  type ScoreDistribution,
} from "./lib/scoring.js";

export { getDatabase, closeDatabase } from "./db/database.js";
