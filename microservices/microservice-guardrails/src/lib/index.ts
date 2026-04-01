/**
 * @hasna/microservice-guardrails — PII detection, prompt injection defense, toxicity filtering, policy enforcement.
 *
 * Usage in your app:
 *   import { checkInput, checkOutput, scanPII, detectPromptInjection } from '@hasna/microservice-guardrails'
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// Allowlist
export {
  type AllowlistEntry,
  addAllowlistEntry,
  deleteAllowlistEntry,
  listAllowlistEntries,
} from "./allowlist.js";
// Guard (main entry points)
export {
  checkInput,
  checkOutput,
  type GuardResult,
  type GuardViolation,
} from "./guard.js";
// Injection
export {
  detectPromptInjection,
  type InjectionResult,
} from "./injection.js";
// PII
export {
  type PIIMatch,
  redactPII,
  scanPII,
} from "./pii.js";
// Policy
export {
  createPolicy,
  deletePolicy,
  evaluatePolicy,
  getPolicy,
  listPolicies,
  type Policy,
  type PolicyResult,
  type PolicyRule,
  type PolicyViolation,
  updatePolicy,
} from "./policy.js";
// Toxicity
export { checkToxicity } from "./toxicity.js";
// Violations
export {
  listViolations,
  logViolation,
  type Violation,
} from "./violations.js";
