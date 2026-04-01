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
  "AI",
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
    tags: [
      "auth",
      "users",
      "sessions",
      "jwt",
      "oauth",
      "2fa",
      "api-keys",
      "magic-links",
    ],
    requiredEnv: ["DATABASE_URL", "JWT_SECRET"],
    optionalEnv: [
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "AUTH_PORT",
    ],
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
    tags: [
      "teams",
      "workspaces",
      "rbac",
      "invites",
      "permissions",
      "multi-tenancy",
    ],
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
    tags: [
      "billing",
      "stripe",
      "subscriptions",
      "plans",
      "invoices",
      "usage",
      "webhooks",
    ],
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
    tags: [
      "notifications",
      "email",
      "sms",
      "in-app",
      "webhooks",
      "templates",
      "sse",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: [
      "RESEND_API_KEY",
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASS",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "NOTIFY_PORT",
    ],
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
    tags: [
      "files",
      "uploads",
      "s3",
      "storage",
      "images",
      "presigned-urls",
      "cdn",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: [
      "S3_BUCKET",
      "S3_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "FILES_STORAGE",
      "FILES_PORT",
    ],
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
    tags: [
      "feature-flags",
      "experiments",
      "rollouts",
      "ab-testing",
      "targeting",
    ],
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
    tags: [
      "jobs",
      "queues",
      "background",
      "cron",
      "scheduling",
      "workers",
      "retry",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["JOBS_PORT", "JOBS_WORKER_CONCURRENCY"],
  },

  // ─── AI-Native Layer ──────────────────────────────────────────────────────

  {
    name: "llm",
    displayName: "LLM",
    description:
      "LLM gateway: multi-provider routing (OpenAI/Anthropic/Groq), per-workspace rate limiting, token cost tracking, response caching, and fallback chains.",
    category: "AI",
    package: "@hasna/microservice-llm",
    binary: "microservice-llm",
    schemaPrefix: "llm",
    tags: [
      "llm",
      "openai",
      "anthropic",
      "groq",
      "ai",
      "gateway",
      "cost-tracking",
      "rate-limiting",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GROQ_API_KEY",
      "LLM_PORT",
    ],
  },
  {
    name: "memory",
    displayName: "Memory",
    description:
      "Persistent agent memory with pgvector semantic search, full-text fallback, importance scoring, collections, and per-user/workspace recall.",
    category: "AI",
    package: "@hasna/microservice-memory",
    binary: "microservice-memory",
    schemaPrefix: "memory",
    tags: [
      "memory",
      "embeddings",
      "pgvector",
      "semantic-search",
      "rag",
      "ai-agents",
      "recall",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["OPENAI_API_KEY", "MEMORY_PORT"],
  },
  {
    name: "search",
    displayName: "Search",
    description:
      "Full-text + semantic/vector search (pgvector) across any data collection. Hybrid BM25+cosine scoring. Works without API keys (text-only mode).",
    category: "AI",
    package: "@hasna/microservice-search",
    binary: "microservice-search",
    schemaPrefix: "search",
    tags: [
      "search",
      "full-text",
      "semantic",
      "vector",
      "pgvector",
      "hybrid",
      "rag",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["OPENAI_API_KEY", "SEARCH_PORT"],
  },
  {
    name: "knowledge",
    displayName: "Knowledge",
    description:
      "RAG knowledge base: document ingestion, chunking (fixed/paragraph/sentence/recursive), embedding, and semantic/text/hybrid retrieval with source attribution.",
    category: "AI",
    package: "@hasna/microservice-knowledge",
    binary: "microservice-knowledge",
    schemaPrefix: "knowledge",
    tags: [
      "knowledge",
      "rag",
      "chunking",
      "embeddings",
      "retrieval",
      "pgvector",
      "documents",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["OPENAI_API_KEY", "KNOWLEDGE_PORT"],
  },

  // ─── Operations Layer ──────────────────────────────────────────────────────

  {
    name: "usage",
    displayName: "Usage",
    description:
      "Usage metering for API calls, tokens, storage, or any custom metric. Quota enforcement, daily/monthly aggregates, overage detection.",
    category: "Observability",
    package: "@hasna/microservice-usage",
    binary: "microservice-usage",
    schemaPrefix: "usage",
    tags: ["usage", "metering", "quotas", "billing", "limits", "analytics"],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["USAGE_PORT"],
  },
  {
    name: "webhooks",
    displayName: "Webhooks",
    description:
      "Reliable outbound webhook delivery with HMAC signing, retries (exponential backoff), delivery logs, and endpoint health tracking.",
    category: "Infrastructure",
    package: "@hasna/microservice-webhooks",
    binary: "microservice-webhooks",
    schemaPrefix: "webhooks",
    tags: [
      "webhooks",
      "outbound",
      "delivery",
      "retry",
      "signing",
      "integrations",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["WEBHOOKS_PORT"],
  },

  // ─── Growth Layer ──────────────────────────────────────────────────────────

  {
    name: "onboarding",
    displayName: "Onboarding",
    description:
      "User activation flows with checklist step tracking, required vs optional steps, completion percentage, and per-user/workspace progress.",
    category: "Growth",
    package: "@hasna/microservice-onboarding",
    binary: "microservice-onboarding",
    schemaPrefix: "onboarding",
    tags: ["onboarding", "activation", "checklists", "flows", "user-journey"],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["ONBOARDING_PORT"],
  },
  {
    name: "waitlist",
    displayName: "Waitlist",
    description:
      "Waitlist management with referral codes, priority scoring, batch invite logic, and per-campaign tracking. Standard for AI product launches.",
    category: "Growth",
    package: "@hasna/microservice-waitlist",
    binary: "microservice-waitlist",
    schemaPrefix: "waitlist",
    tags: ["waitlist", "referral", "invites", "launch", "growth"],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["WAITLIST_PORT"],
  },

  // ─── Agent Infrastructure Layer ────────────────────────────────────────────

  {
    name: "sessions",
    displayName: "Sessions",
    description:
      "AI conversation history: message threads, context window management, multi-turn state, fork/pin, full-text search across messages, export as markdown/JSON.",
    category: "AI",
    package: "@hasna/microservice-sessions",
    binary: "microservice-sessions",
    schemaPrefix: "sessions",
    tags: [
      "sessions",
      "conversations",
      "chat",
      "messages",
      "context-window",
      "history",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["SESSIONS_PORT"],
  },
  {
    name: "guardrails",
    displayName: "Guardrails",
    description:
      "AI safety layer: prompt injection detection, PII scanning (email/phone/SSN/CC), toxicity check, configurable per-workspace policies, violation logging.",
    category: "AI",
    package: "@hasna/microservice-guardrails",
    binary: "microservice-guardrails",
    schemaPrefix: "guardrails",
    tags: [
      "guardrails",
      "safety",
      "pii",
      "injection",
      "toxicity",
      "moderation",
      "policy",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["GUARDRAILS_PORT"],
  },
  {
    name: "traces",
    displayName: "Traces",
    description:
      "Agent observability: span-based distributed tracing for LLM calls, tool calls, and decisions. Duration, token, and cost tracking per span. Stats with percentiles.",
    category: "Observability",
    package: "@hasna/microservice-traces",
    binary: "microservice-traces",
    schemaPrefix: "traces",
    tags: [
      "traces",
      "tracing",
      "spans",
      "observability",
      "latency",
      "debugging",
      "agent-ops",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["TRACES_PORT"],
  },
  {
    name: "agents",
    displayName: "Agents",
    description:
      "Agent registry and orchestration: register agents with capabilities, health tracking via heartbeat, capability-based task routing, agent-to-agent messaging.",
    category: "AI",
    package: "@hasna/microservice-agents",
    binary: "microservice-agents",
    schemaPrefix: "agents",
    tags: [
      "agents",
      "registry",
      "orchestration",
      "routing",
      "multi-agent",
      "capabilities",
      "heartbeat",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["AGENTS_PORT"],
  },
  {
    name: "prompts",
    displayName: "Prompts",
    description:
      "Versioned prompt management: auto-incrementing versions, per-workspace/user/agent overrides, A/B experiment variants, rollback, variable interpolation, diff.",
    category: "AI",
    package: "@hasna/microservice-prompts",
    binary: "microservice-prompts",
    schemaPrefix: "prompts",
    tags: [
      "prompts",
      "templates",
      "versioning",
      "ab-testing",
      "overrides",
      "rollback",
    ],
    requiredEnv: ["DATABASE_URL"],
    optionalEnv: ["PROMPTS_PORT"],
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
export function getMicroservicesByCategory(
  category: Category,
): MicroserviceMeta[] {
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
      m.tags.some((t) => t.includes(q)),
  );
}
