export {
  buildOpenPackageSecretPath,
  createAllProductionStorageContracts,
  createProductionStorageContract,
  envPrefixForService,
  formatProductionStorageContract,
  normalizeOpenServiceName,
  type ProductionContractValidation,
  type ProductionStorageContract,
  type SecretKind,
  validateProductionStorageContract,
} from "./lib/production-contract.js";
export { MICROSERVICES, type MicroserviceMeta } from "./lib/registry.js";

import {
  createAllProductionStorageContracts,
  createProductionStorageContract,
  type ProductionStorageContract,
} from "./lib/production-contract.js";
import { MICROSERVICES } from "./lib/registry.js";

export const MICROSERVICES_STORAGE_ENV = {
  mode: "HASNA_MICROSERVICES_STORAGE_MODE",
  databaseUrl: "HASNA_MICROSERVICES_DATABASE_URL",
  databaseSchema: "HASNA_MICROSERVICES_DATABASE_SCHEMA",
  databaseSsl: "HASNA_MICROSERVICES_DATABASE_SSL",
  s3Bucket: "HASNA_MICROSERVICES_S3_BUCKET",
  s3Prefix: "HASNA_MICROSERVICES_S3_PREFIX",
  awsRegion: "HASNA_MICROSERVICES_AWS_REGION",
} as const;

export const MICROSERVICES_STORAGE_FALLBACK_ENV = {
  mode: "MICROSERVICES_STORAGE_MODE",
  databaseUrl: "MICROSERVICES_DATABASE_URL",
  databaseSchema: "MICROSERVICES_DATABASE_SCHEMA",
  databaseSsl: "MICROSERVICES_DATABASE_SSL",
  s3Bucket: "MICROSERVICES_S3_BUCKET",
  s3Prefix: "MICROSERVICES_S3_PREFIX",
  awsRegion: "MICROSERVICES_AWS_REGION",
} as const;

export const STORAGE_MODE_ENV = MICROSERVICES_STORAGE_ENV.mode;
export const STORAGE_DATABASE_ENV = MICROSERVICES_STORAGE_ENV.databaseUrl;
export const STORAGE_TABLES = [] as const;

export type MicroservicesStorageMode = "local" | "remote" | "hybrid";

export interface MicroservicesStorageStatus {
  configured: boolean;
  mode: MicroservicesStorageMode;
  contractOnly: true;
  env: typeof MICROSERVICES_STORAGE_ENV;
  fallbackEnv: typeof MICROSERVICES_STORAGE_FALLBACK_ENV;
  registeredServices: number;
  remote: {
    configured: boolean;
    databaseEnv: string;
    schemaEnv: string;
    s3BucketEnv: string;
    awsRegionEnv: string;
  };
  tables: readonly [];
}

function firstEnv(
  env: NodeJS.ProcessEnv,
  primary: string,
  fallback: string,
): string | undefined {
  return env[primary] || env[fallback] || undefined;
}

function parseMode(value: string | undefined): MicroservicesStorageMode {
  if (value === "remote" || value === "postgres") return "remote";
  if (value === "hybrid") return "hybrid";
  return "local";
}

export function getStorageMode(
  env: NodeJS.ProcessEnv = process.env,
): MicroservicesStorageMode {
  return parseMode(
    firstEnv(
      env,
      MICROSERVICES_STORAGE_ENV.mode,
      MICROSERVICES_STORAGE_FALLBACK_ENV.mode,
    ),
  );
}

export function getStorageDatabaseEnvName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env[MICROSERVICES_STORAGE_ENV.databaseUrl]
    ? MICROSERVICES_STORAGE_ENV.databaseUrl
    : MICROSERVICES_STORAGE_FALLBACK_ENV.databaseUrl;
}

export function getStorageDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return firstEnv(
    env,
    MICROSERVICES_STORAGE_ENV.databaseUrl,
    MICROSERVICES_STORAGE_FALLBACK_ENV.databaseUrl,
  );
}

export function getStorageStatus(
  env: NodeJS.ProcessEnv = process.env,
): MicroservicesStorageStatus {
  return {
    configured:
      Boolean(getStorageDatabaseUrl(env)) || getStorageMode(env) === "local",
    mode: getStorageMode(env),
    contractOnly: true,
    env: MICROSERVICES_STORAGE_ENV,
    fallbackEnv: MICROSERVICES_STORAGE_FALLBACK_ENV,
    registeredServices: MICROSERVICES.length,
    remote: {
      configured: Boolean(getStorageDatabaseUrl(env)),
      databaseEnv: getStorageDatabaseEnvName(env),
      schemaEnv: env[MICROSERVICES_STORAGE_ENV.databaseSchema]
        ? MICROSERVICES_STORAGE_ENV.databaseSchema
        : MICROSERVICES_STORAGE_FALLBACK_ENV.databaseSchema,
      s3BucketEnv: env[MICROSERVICES_STORAGE_ENV.s3Bucket]
        ? MICROSERVICES_STORAGE_ENV.s3Bucket
        : MICROSERVICES_STORAGE_FALLBACK_ENV.s3Bucket,
      awsRegionEnv: env[MICROSERVICES_STORAGE_ENV.awsRegion]
        ? MICROSERVICES_STORAGE_ENV.awsRegion
        : MICROSERVICES_STORAGE_FALLBACK_ENV.awsRegion,
    },
    tables: STORAGE_TABLES,
  };
}

export function getMicroservicesStorageStatus(
  env: NodeJS.ProcessEnv = process.env,
): MicroservicesStorageStatus {
  return getStorageStatus(env);
}

export function createMicroservicesStorageContract(
  service: string,
  options: { environment?: string; objectStorageRequired?: boolean } = {},
): ProductionStorageContract {
  return createProductionStorageContract(service, options);
}

export function createAllMicroservicesStorageContracts(
  options: { environment?: string } = {},
): ProductionStorageContract[] {
  return createAllProductionStorageContracts(options);
}
