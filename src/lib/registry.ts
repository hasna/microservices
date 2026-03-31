/**
 * Microservice registry — production-grade building blocks for SaaS apps.
 *
 * Each microservice is an independent npm package (@hasna/microservice-<name>)
 * with its own PostgreSQL schema, HTTP API, MCP server, and CLI.
 */

export interface MicroserviceMeta {
  name: string;
  displayName: string;
  description: string;
  category: Category;
  package: string;
  binary: string;
  schemaPrefix: string;
  tags: string[];
  requiredEnv: string[];
  optionalEnv?: string[];
  version?: string;
}

export const CATEGORIES = [
  "Identity",
  "Organization",
  "Monetization",
  "Communication",
  "Storage",
  "Observability",
  "Growth",
  "Infrastructure",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const MICROSERVICES: MicroserviceMeta[] = [
  {
    name: "auth",
    displayName: "Auth",
    description:
      "Users, sessions, JWT, magic links, OAuth (GitHub/Google), 2FA (TOTP), and API keys. The identity foundation every SaaS needs.",
    category: "Identity",
    package: "@hasna/microservice-auth",
    binary: "microservice-auth",
    schemaPrefix: "auth",
    tags: ["auth", "users", "sessions", "jwt", "oauth", "2fa", "api-keys", "magic-links"],
    requiredEnv: ["DATABASE_URL", "JWT_SECRET"],
    optionalEnv: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_PORT"],
  },
  {
    name: "teams",
    displayName: "Teams",
    description:
      "Workspaces, members, RBAC (owner/admin/member/viewer), invites, and permission checks. Multi-tenancy for any SaaS.",
    category: "Organization",
    package: "@hasna/microservice-teams",
    binary: "microservice-teams",
    schemaPrefix: "teams",
    tags: ["teams", "workspaces", "rbac", "invites", "permissions", "multi-tenancy"],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["TEAMS_PORT"],
  },
  {
    name: "billing",
    displayName: "Billing",
    description:
      "Stripe subscriptions, plans, invoices, usage-based billing, and webhook handling. Drop-in monetization for SaaS.",
    category: "Monetization",
    package: "@hasna/microservice-billing",
    binary: "microservice-billing",
    schemaPrefix: "billing",
    tags: ["billing", "stripe", "subscriptions", "plans", "invoices", "usage", "webhooks"],
    requiredEnv: ["DATABASE_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    optionalEnv: ["BILLING_PORT"],
  },
  {
    name: "notify",
    displayName: "Notify",
    description:
      "Email (Resend/SMTP), SMS (Twilio), in-app (SSE), and outbound webhooks. Template system with per-user preferences.",
    category: "Communication",
    package: "@hasna/microservice-notify",
    binary: "microservice-notify",
    schemaPrefix: "notify",
    tags: ["notifications", "email", "sms", "in-app", "webhooks", "templates", "sse"],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["RESEND_API_KEY", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "NOTIFY_PORT"],
  },
  {
    name: "files",
    displayName: "Files",
    description:
      "File uploads, S3 storage, presigned URLs, image transforms, and access control (public/private/signed).",
    category: "Storage",
    package: "@hasna/microservice-files",
    binary: "microservice-files",
    schemaPrefix: "files",
    tags: ["files", "uploads", "s3", "storage", "images", "presigned-urls", "cdn"],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["S3_BUCKET", "S3_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "FILES_STORAGE", "FILES_PORT"],
  },
  {
    name: "audit",
    displayName: "Audit",
    description:
      "Immutable append-only event log for compliance and activity history. Query, export, and retention policies built-in.",
    category: "Observability",
    package: "@hasna/microservice-audit",
    binary: "microservice-audit",
    schemaPrefix: "audit",
    tags: ["audit", "events", "compliance", "activity", "log", "immutable"],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["AUDIT_PORT", "AUDIT_RETENTION_DAYS"],
  },
  {
    name: "flags",
    displayName: "Flags",
    description:
      "Feature flags, gradual rollouts, A/B experiments, and per-user/workspace overrides. Ship faster with less risk.",
    category: "Growth",
    package: "@hasna/microservice-flags",
    binary: "microservice-flags",
    schemaPrefix: "flags",
    tags: ["feature-flags", "experiments", "rollouts", "ab-testing", "targeting"],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["FLAGS_PORT"],
  },
  {
    name: "jobs",
    displayName: "Jobs",
    description:
      "Background jobs, priority queues (PostgreSQL SKIP LOCKED), cron scheduling, retries with backoff, and dead letter queue.",
    category: "Infrastructure",
    package: "@hasna/microservice-jobs",
    binary: "microservice-jobs",
    schemaPrefix: "jobs",
    tags: ["jobs", "queues", "background", "cron", "scheduling", "workers", "retry"],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["JOBS_PORT", "JOBS_WORKER_CONCURRENCY"],
  },
];

/**
 * Get a microservice by name
 */
export function getMicroservice(name: string): MicroserviceMeta | undefined {
  const key = name.replace("microservice-", "");
  return MICROSERVICES.find((m) => m.name === key);
}

/**
 * Get microservices by category
 */
export function getMicroservicesByCategory(category: Category): MicroserviceMeta[] {
  return MICROSERVICES.filter((m) => m.category === category);
}

/**
 * Search microservices by name, description, or tags
 */
export function searchMicroservices(query: string): MicroserviceMeta[] {
  const q = query.toLowerCase();
  return MICROSERVICES.filter(
    (m) =>
      m.name.includes(q) ||
      m.displayName.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.tags.some((t) => t.includes(q))
  );
}
