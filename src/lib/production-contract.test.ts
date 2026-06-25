import { describe, expect, test } from "bun:test";
import {
  buildOpenPackageSecretPath,
  createAllProductionStorageContracts,
  createProductionStorageContract,
  envPrefixForService,
  normalizeOpenServiceName,
  validateProductionStorageContract,
} from "./production-contract.js";
import { MICROSERVICES } from "./registry.js";

describe("production storage contract", () => {
  test("normalizes open package and wrapper aliases to canonical service names", () => {
    expect(normalizeOpenServiceName("connect")).toBe("connectors");
    expect(normalizeOpenServiceName("connector/prod/env")).toBe("connectors");
    expect(normalizeOpenServiceName("open-connectors")).toBe("connectors");
    expect(normalizeOpenServiceName("platform-repositories")).toBe("repos");
    expect(normalizeOpenServiceName("@hasna/microservice-auth")).toBe("auth");
  });

  test("builds the standard Secrets Manager path layout", () => {
    expect(buildOpenPackageSecretPath("connect", "env")).toBe(
      "hasna/xyz/opensource/connectors/prod/env",
    );
    expect(buildOpenPackageSecretPath("todos", "rds")).toBe(
      "hasna/xyz/opensource/todos/prod/rds",
    );
    expect(buildOpenPackageSecretPath("open-skills", "s3", "staging")).toBe(
      "hasna/xyz/opensource/skills/staging/s3",
    );
  });

  test("uses service-prefixed HASNA env names for direct open package remote state", () => {
    const contract = createProductionStorageContract("open-todos");

    expect(envPrefixForService("open-todos")).toBe("HASNA_TODOS");
    expect(contract.database).toMatchObject({
      name: "opensource_todos_prod",
      schema: "todos",
      urlEnv: "HASNA_TODOS_DATABASE_URL",
      sslEnv: "HASNA_TODOS_DATABASE_SSL",
      schemaEnv: "HASNA_TODOS_DATABASE_SCHEMA",
      purpose: "internal-oss-remote-state",
      separatedFrom: "saas-wrapper-tenant-database",
    });
    expect(contract.objectStorage).toMatchObject({
      bucket: "hasna-xyz-opensource-todos-prod",
      prefix: "todos/",
      bucketEnv: "HASNA_TODOS_S3_BUCKET",
      regionEnv: "HASNA_TODOS_AWS_REGION",
    });
  });

  test("maps registry microservices to production contracts", () => {
    const files = createProductionStorageContract("files");
    const auth = createProductionStorageContract("auth");

    expect(files).toMatchObject({
      service: "files",
      packageName: "@hasna/microservice-files",
      binary: "microservice-files",
      schemaPrefix: "files",
      runtime: { microserviceEnv: "DATABASE_URL", portEnv: "FILES_PORT" },
      deploy: {
        migrationCommand: "microservice-files migrate",
        healthPath: "/files/health",
      },
    });
    expect(files.objectStorage.required).toBe(true);
    expect(auth.objectStorage.required).toBe(false);
  });

  test("validates all registry services against the shared production standard", () => {
    const contracts = createAllProductionStorageContracts();

    expect(contracts).toHaveLength(MICROSERVICES.length);
    for (const contract of contracts) {
      expect(validateProductionStorageContract(contract)).toEqual({
        service: contract.service,
        ok: true,
        errors: [],
      });
      expect(contract.secrets.env).toContain(`/${contract.service}/prod/env`);
      expect(contract.objectStorage.bucket).toContain(
        `opensource-${contract.service}-prod`,
      );
    }
  });

  test("flags noncanonical or mixed production naming", () => {
    const contract = createProductionStorageContract("todos");
    const invalid = {
      ...contract,
      secrets: {
        ...contract.secrets,
        env: "hasna/xyz/opensource/connect/prod/env",
      },
      objectStorage: {
        ...contract.objectStorage,
        bucket: "hasna-xyz-prod-opensource-todos",
      },
    };

    expect(validateProductionStorageContract(invalid).ok).toBe(false);
    expect(validateProductionStorageContract(invalid).errors).toEqual(
      expect.arrayContaining([
        "secret paths must use hasna/xyz/opensource/[service]/[environment]/...",
        "connect is not canonical; use connectors",
        "bucket names must use opensource-[service]-prod ordering",
      ]),
    );
  });
});
