/**
 * @hasna/microservice-guardrails — PII detection, prompt injection defense, toxicity filtering, policy enforcement.
 *
 * Usage in your app:
 *   import { checkInput, checkOutput, scanPII, detectPromptInjection } from '@hasna/microservice-guardrails'
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// PII
export {
  scanPII,
  redactPII,
  type PIIMatch,
} from "./pii.js";

// Injection
export {
  detectPromptInjection,
  type InjectionResult,
} from "./injection.js";

// Toxicity
export {
  checkToxicity,
} from "./toxicity.js";

// Policy
export {
  createPolicy,
  listPolicies,
  getPolicy,
  updatePolicy,
  deletePolicy,
  evaluatePolicy,
  type Policy,
  type PolicyRule,
  type PolicyResult,
  type PolicyViolation,
} from "./policy.js";

// Guard (main entry points)
export {
  checkInput,
  checkOutput,
  type GuardResult,
  type GuardViolation,
} from "./guard.js";

// Violations
export {
  logViolation,
  listViolations,
  type Violation,
} from "./violations.js";

// Allowlist
export {
  addAllowlistEntry,
  listAllowlistEntries,
  deleteAllowlistEntry,
  type AllowlistEntry,
} from "./allowlist.js";
