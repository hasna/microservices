/**
 * @hasna/microservices - Mini business apps for AI agents
 *
 * Install microservices with a single command:
 *   npx @hasna/microservices install contacts invoices
 *
 * Or use the interactive CLI:
 *   npx @hasna/microservices
 */

export {
  MICROSERVICES,
  CATEGORIES,
  getMicroservice,
  getMicroservicesByCategory,
  searchMicroservices,
  type MicroserviceMeta,
  type Category,
} from "./lib/registry.js";

export {
  installMicroservice,
  installMicroservices,
  getInstalledMicroservices,
  removeMicroservice,
  microserviceExists,
  getMicroservicePath,
  getMicroserviceStatus,
  type InstallResult,
  type InstallOptions,
} from "./lib/installer.js";

export {
  openServiceDatabase,
  getMicroservicesDir,
  getServiceDataDir,
  getServiceDbPath,
  generateId,
  now,
  type MigrationEntry,
} from "./lib/database.js";

export {
  runMicroserviceCommand,
  getMicroserviceOperations,
  getMicroserviceCliPath,
  type RunResult,
} from "./lib/runner.js";

export { PG_MIGRATIONS } from "./lib/pg-migrations.js";
