/**
 * microservice-crm — CRM pipeline management microservice
 */

export {
  createPipeline,
  listPipelines,
  createStage,
  listStages,
  createDeal,
  getDeal,
  listDeals,
  updateDeal,
  moveDeal,
  closeDeal,
  deleteDeal,
  addActivity,
  listActivities,
  getPipelineSummary,
  type Pipeline,
  type Stage,
  type Deal,
  type DealActivity,
  type CreatePipelineInput,
  type CreateStageInput,
  type CreateDealInput,
  type UpdateDealInput,
  type ListDealsOptions,
  type AddActivityInput,
  type PipelineSummary,
  type StageSummary,
} from "./db/pipeline.js";

export { getDatabase, closeDatabase } from "./db/database.js";
