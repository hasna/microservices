/**
 * @hasna/microservices — Production-grade building blocks for SaaS apps.
 *
 * Each microservice is an independent npm package with its own PostgreSQL schema,
 * HTTP API, MCP server, and CLI binary. This meta-package provides the registry,
 * installer, and runner for managing them all.
 *
 * Available microservices (21 total):
 *   @hasna/microservice-auth     — users, sessions, JWT, OAuth, 2FA, API keys
 *   @hasna/microservice-teams    — workspaces, members, RBAC, invites
 *   @hasna/microservice-billing  — Stripe subscriptions, plans, invoices
 *   @hasna/microservice-llm      — gateway, multi-provider routing, cost tracking
 *   @hasna/microservice-agents   — orchestrator, capabilities, routing
 *   @hasna/microservice-memory   — persistent agent memory, vector search
 *   ...and 15 more (notify, files, audit, flags, jobs, search, traces, etc).
 *
 * Quick start:
 *   npx @hasna/microservices install auth teams billing
 *   microservices init-all --db postgres://postgres:password@localhost:5432/microservices
 *   microservices serve-all
 */

export {
  getInstalledMicroservices,
  getMicroserviceStatus,
  getMicroserviceVersion,
  type InstallOptions,
  type InstallResult,
  installMicroservice,
  installMicroservices,
  microserviceExists,
  removeMicroservice,
} from "./lib/installer.js";
export {
  CATEGORIES,
  type Category,
  getMicroservice,
  getMicroservicesByCategory,
  MICROSERVICES,
  type MicroserviceMeta,
  searchMicroservices,
} from "./lib/registry.js";

export {
  getMicroserviceOperations,
  type RunResult,
  runMicroserviceCommand,
} from "./lib/runner.js";
