/**
 * microservice-projects — Project management microservice
 */

export {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  searchProjects,
  type Project,
  type CreateProjectInput,
  type UpdateProjectInput,
  type ListProjectsOptions,
} from "./db/projects.js";

export {
  createMilestone,
  getMilestone,
  listMilestones,
  updateMilestone,
  completeMilestone,
  deleteMilestone,
  type Milestone,
  type CreateMilestoneInput,
  type UpdateMilestoneInput,
  type ListMilestonesOptions,
} from "./db/projects.js";

export {
  createDeliverable,
  getDeliverable,
  listDeliverables,
  updateDeliverable,
  completeDeliverable,
  deleteDeliverable,
  type Deliverable,
  type CreateDeliverableInput,
  type UpdateDeliverableInput,
  type ListDeliverablesOptions,
} from "./db/projects.js";

export {
  getProjectTimeline,
  getBudgetVsActual,
  getOverdueProjects,
  getOverdueMilestones,
  getProjectStats,
  getMilestoneProgress,
  type TimelineEntry,
  type BudgetReport,
  type ProjectStats,
  type MilestoneProgress,
} from "./db/projects.js";

export { getDatabase, closeDatabase } from "./db/database.js";
