import {
  getMicroservice,
  MICROSERVICES,
  type MicroserviceMeta,
} from "./registry.js";

export type SecretKind = "env" | "rds" | "s3";

export interface ProductionStorageContract {
  service: string;
  environment: string;
  packageName: string | null;
  binary: string | null;
  schemaPrefix: string;
  secrets: Record<SecretKind, string>;
  database: {
    name: string;
    schema: string;
    urlEnv: string;
    sslEnv: string;
    schemaEnv: string;
    purpose: "internal-oss-remote-state";
    separatedFrom: "saas-wrapper-tenant-database";
  };
  objectStorage: {
    bucket: string;
    prefix: string;
    bucketEnv: string;
    prefixEnv: string;
    regionEnv: string;
    accessKeyEnv: string;
    secretKeyEnv: string;
    sessionTokenEnv: string;
    required: boolean;
  };
  runtime: {
    microserviceEnv: "DATABASE_URL";
    portEnv: string | null;
    requiredEnv: string[];
    optionalEnv: string[];
  };
  deploy: {
    healthPath: string;
    migrationCommand: string;
    serviceRoute: string;
  };
}

export interface ProductionContractValidation {
  service: string;
  ok: boolean;
  errors: string[];
}

const SECRET_ROOT = "hasna/xyz/opensource";
const SERVICE_ALIASES: Record<string, string> = {
  account: "accounts",
  attach: "attachments",
  attachment: "attachments",
  calendar: "calendar",
  code: "coders",
  coder: "coders",
  config: "configs",
  connect: "connectors",
  connector: "connectors",
  conversation: "conversations",
  domain: "domains",
  economy: "economy",
  email: "emails",
  eval: "evals",
  file: "files",
  hook: "hooks",
  log: "logs",
  machine: "machines",
  markdown: "markdown",
  mcp: "mcps",
  memento: "mementos",
  microservice: "microservices",
  project: "projects",
  prompt: "prompts",
  recording: "recordings",
  repo: "repos",
  repositories: "repos",
  repository: "repos",
  sandbox: "sandboxes",
  search: "search",
  secret: "secrets",
  session: "sessions",
  skill: "skills",
  style: "styles",
  tester: "testers",
  ticket: "tickets",
  todo: "todos",
};

export function normalizeOpenServiceName(input: string): string {
  let value = input.trim().toLowerCase();
  if (value.startsWith("@hasna/")) value = value.slice("@hasna/".length);
  value = value.split(/[/:]/)[0] ?? "";
  value = value
    .replace(/^open-/, "")
    .replace(/^platform-/, "")
    .replace(/^microservice-/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  const normalized = SERVICE_ALIASES[value] ?? value;
  assertServiceName(normalized);
  return normalized;
}

export function envPrefixForService(service: string): string {
  return `HASNA_${normalizeOpenServiceName(service).replace(/-/g, "_").toUpperCase()}`;
}

export function buildOpenPackageSecretPath(
  service: string,
  kind: SecretKind,
  environment = "prod",
): string {
  const canonical = normalizeOpenServiceName(service);
  assertEnvironmentName(environment);
  return `${SECRET_ROOT}/${canonical}/${environment}/${kind}`;
}

export function createProductionStorageContract(
  input: string | MicroserviceMeta,
  options: { environment?: string; objectStorageRequired?: boolean } = {},
): ProductionStorageContract {
  const meta = typeof input === "string" ? getMicroservice(input) : input;
  const service = normalizeOpenServiceName(
    typeof input === "string" ? input : input.name,
  );
  const environment = options.environment ?? "prod";
  assertEnvironmentName(environment);

  const prefix = envPrefixForService(service);
  const schemaPrefix = meta?.schemaPrefix ?? service.replace(/-/g, "_");
  const portEnv = firstPortEnv(meta);
  const objectStorageRequired =
    options.objectStorageRequired ?? service === "files";

  return {
    service,
    environment,
    packageName: meta?.package ?? null,
    binary: meta?.binary ?? null,
    schemaPrefix,
    secrets: {
      env: buildOpenPackageSecretPath(service, "env", environment),
      rds: buildOpenPackageSecretPath(service, "rds", environment),
      s3: buildOpenPackageSecretPath(service, "s3", environment),
    },
    database: {
      name: `opensource_${service.replace(/-/g, "_")}_${environment}`,
      schema: schemaPrefix,
      urlEnv: `${prefix}_DATABASE_URL`,
      sslEnv: `${prefix}_DATABASE_SSL`,
      schemaEnv: `${prefix}_DATABASE_SCHEMA`,
      purpose: "internal-oss-remote-state",
      separatedFrom: "saas-wrapper-tenant-database",
    },
    objectStorage: {
      bucket: `hasna-xyz-opensource-${service}-${environment}`,
      prefix: `${service}/`,
      bucketEnv: `${prefix}_S3_BUCKET`,
      prefixEnv: `${prefix}_S3_PREFIX`,
      regionEnv: `${prefix}_AWS_REGION`,
      accessKeyEnv: `${prefix}_S3_ACCESS_KEY_ID`,
      secretKeyEnv: `${prefix}_S3_SECRET_ACCESS_KEY`,
      sessionTokenEnv: `${prefix}_S3_SESSION_TOKEN`,
      required: objectStorageRequired,
    },
    runtime: {
      microserviceEnv: "DATABASE_URL",
      portEnv,
      requiredEnv: meta?.requiredEnv ?? [],
      optionalEnv: meta?.optionalEnv ?? [],
    },
    deploy: {
      healthPath: `/${service}/health`,
      migrationCommand: meta?.binary
        ? `${meta.binary} migrate`
        : `${service} migrate`,
      serviceRoute: `/${service}`,
    },
  };
}

export function createAllProductionStorageContracts(
  options: { environment?: string } = {},
): ProductionStorageContract[] {
  return MICROSERVICES.map((service) =>
    createProductionStorageContract(service, options),
  );
}

export function validateProductionStorageContract(
  contract: ProductionStorageContract,
): ProductionContractValidation {
  const errors: string[] = [];
  if (!contract.secrets.env.startsWith(`${SECRET_ROOT}/${contract.service}/`)) {
    errors.push(
      "secret paths must use hasna/xyz/opensource/[service]/[environment]/...",
    );
  }
  if (contract.secrets.env.includes("/connect/")) {
    errors.push("connect is not canonical; use connectors");
  }
  if (
    !contract.database.urlEnv.startsWith(
      `${envPrefixForService(contract.service)}_`,
    )
  ) {
    errors.push(
      "database env names must be service-prefixed HASNA_[SERVICE]_* names",
    );
  }
  if (contract.database.separatedFrom !== "saas-wrapper-tenant-database") {
    errors.push(
      "direct open-package remote state must be separate from SaaS tenant databases",
    );
  }
  if (contract.objectStorage.bucket.startsWith("hasna-xyz-prod-")) {
    errors.push("bucket names must use opensource-[service]-prod ordering");
  }
  return { service: contract.service, ok: errors.length === 0, errors };
}

export function formatProductionStorageContract(
  contract: ProductionStorageContract,
): string {
  const storageRequired = contract.objectStorage.required
    ? "required"
    : "optional";
  return [
    `${contract.service} (${contract.environment})`,
    `  Secrets: ${contract.secrets.env}, ${contract.secrets.rds}, ${contract.secrets.s3}`,
    `  RDS: ${contract.database.name} / schema ${contract.database.schema} / env ${contract.database.urlEnv}`,
    `  S3: ${contract.objectStorage.bucket} / prefix ${contract.objectStorage.prefix} (${storageRequired})`,
    `  Runtime: ${contract.runtime.microserviceEnv}${contract.runtime.portEnv ? `, ${contract.runtime.portEnv}` : ""}`,
    `  Deploy: ${contract.deploy.migrationCommand} / ${contract.deploy.healthPath}`,
    "  Boundary: direct OSS remote state is separate from SaaS wrapper tenant databases",
  ].join("\n");
}

function firstPortEnv(meta: MicroserviceMeta | undefined): string | null {
  return meta?.optionalEnv?.find((env) => env.endsWith("_PORT")) ?? null;
}

function assertServiceName(service: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(service)) {
    throw new Error(`Invalid service name: ${service}`);
  }
}

function assertEnvironmentName(environment: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(environment)) {
    throw new Error(`Invalid environment name: ${environment}`);
  }
}
