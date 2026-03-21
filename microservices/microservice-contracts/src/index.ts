/**
 * microservice-contracts — Contract and agreement management microservice
 */

export {
  createContract,
  getContract,
  listContracts,
  updateContract,
  deleteContract,
  searchContracts,
  listExpiring,
  renewContract,
  getContractStats,
  type Contract,
  type ContractType,
  type ContractStatus,
  type CreateContractInput,
  type UpdateContractInput,
  type ListContractsOptions,
} from "./db/contracts.js";

export {
  createClause,
  getClause,
  listClauses,
  deleteClause,
  type Clause,
  type CreateClauseInput,
} from "./db/contracts.js";

export {
  createReminder,
  getReminder,
  listReminders,
  deleteReminder,
  listPendingReminders,
  markReminderSent,
  type Reminder,
  type CreateReminderInput,
} from "./db/contracts.js";

export { getDatabase, closeDatabase } from "./db/database.js";
