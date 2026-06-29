import { describe, expect, test } from "bun:test";
import { MICROSERVICES } from "./lib/registry.js";
import {
  createAllMicroservicesStorageContracts,
  createMicroservicesStorageContract,
  getMicroservicesStorageStatus,
  MICROSERVICES_STORAGE_ENV,
} from "./storage.js";

describe("storage contract export", () => {
  test("exposes canonical env names and contract-only status", () => {
    const status = getMicroservicesStorageStatus({});

    expect(status.contractOnly).toBe(true);
    expect(status.mode).toBe("local");
    expect(status.registeredServices).toBe(MICROSERVICES.length);
    expect(status.env.databaseUrl).toBe(MICROSERVICES_STORAGE_ENV.databaseUrl);
    expect(status.remote.databaseEnv).toBe("MICROSERVICES_DATABASE_URL");
    expect(status.tables).toEqual([]);
  });

  test("creates canonical production storage contracts from package aliases", () => {
    const contract = createMicroservicesStorageContract("open-connectors");

    expect(contract.service).toBe("connectors");
    expect(contract.database.urlEnv).toBe("HASNA_CONNECTORS_DATABASE_URL");
    expect(contract.objectStorage.bucket).toBe(
      "hasna-xyz-opensource-connectors-prod",
    );
    expect(contract.database.separatedFrom).toBe(
      "saas-wrapper-tenant-database",
    );
  });

  test("creates contracts for all registered microservices", () => {
    const contracts = createAllMicroservicesStorageContracts();

    expect(contracts).toHaveLength(MICROSERVICES.length);
    expect(contracts.some((contract) => contract.service === "auth")).toBe(
      true,
    );
  });
});
