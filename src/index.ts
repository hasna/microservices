/**
 * @hasna/microservices — Production-grade building blocks for SaaS apps.
 *
 * Each microservice is an independent npm package with its own PostgreSQL schema,
 * HTTP API, MCP server, and CLI binary. This meta-package provides the registry,
 * installer, and runner for managing them all.
 *
 * Available microservices:
 *   @hasna/microservice-auth     — users, sessions, JWT, OAuth, 2FA, API keys
 *   @hasna/microservice-teams    — workspaces, members, RBAC, invites
 *   @hasna/microservice-billing  — Stripe subscriptions, plans, invoices
 *   @hasna/microservice-notify   — email, SMS, in-app, webhooks
 *   @hasna/microservice-files    — uploads, S3, presigned URLs, transforms
 *   @hasna/microservice-audit    — immutable event log, compliance trail
 *   @hasna/microservice-flags    — feature flags, rollouts, A/B experiments
 *   @hasna/microservice-jobs     — background jobs, queues, cron, retries
 *
 * Quick start:
 *   npx @hasna/microservices install auth teams billing
 *   microservice-auth init --db postgres://localhost/myapp
 *   microservice-auth migrate
 *   microservice-auth serve
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
  getMicroserviceVersion,
  getMicroserviceStatus,
  type InstallResult,
  type InstallOptions,
} from "./lib/installer.js";

export {
  runMicroserviceCommand,
  getMicroserviceOperations,
  type RunResult,
} from "./lib/runner.js";
