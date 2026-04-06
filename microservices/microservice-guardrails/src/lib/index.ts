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
// DSL Rules (custom rule DSL)
export {
  type GuardRule,
  type DSLResult,
  type EvaluateGuardRulesResult,
  addGuardRule,
  deleteGuardRule,
  evaluateDSLRule,
  evaluateGuardRules,
  listGuardRules,
  toggleGuardRule,
  updateGuardRule,
} from "./dsl-rules.js";
// Rule Versioning
export {
  type RuleVersion,
  createRuleVersion,
  getRuleVersion,
  listRuleVersions,
  getLatestRuleVersion,
  rollbackRule,
  getRuleVersionDiff,
} from "./rule-versioning.js";
// Rule Composition (AND/OR/NOT groups)
export {
  type RuleGroup,
  type EvaluateGroupResult,
  type RuleOperator,
  createRuleGroup,
  deleteRuleGroup,
  evaluateRuleGroup,
  evaluateAllRuleGroups,
  getRuleGroup,
  listRuleGroups,
  updateRuleGroup,
} from "./guard-policies.js";
// Guard (main entry points)
export {
  checkInput,
  checkOutput,
  checkInputStream,
  checkOutputStream,
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
  type FullPIIMatch,
  redactPII,
  scanPII,
  inspectFull,
  detectIPAddress,
  detectDateOfBirth,
  detectLicensePlate,
  detectMedicalLicense,
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
// Stream Guard
export {
  type StreamGuardConfig,
  streamGuard,
  redactStreamText,
} from "./stream-guard.js";
// Toxicity
export { checkToxicity } from "./toxicity.js";
// Violations
export {
  listViolations,
  logViolation,
  type Violation,
} from "./violations.js";
// Fingerprint
export {
  computeSimhash,
  hammingDistance,
  isNearDuplicate,
  findNearDuplicates,
  computeAverageHash,
  storeFingerprint,
  getFingerprint,
  listFingerprints,
  deleteFingerprint,
} from "./fingerprint.js";
// Audit
export {
  type AuditLogEntry,
  logAuditEntry,
  queryAuditLog,
  getAuditStats,
  pruneAuditLog,
  exportAuditLogJSON,
  exportAuditLogCSV,
} from "./audit.js";
// Client Rate Limits
export {
  type ClientRateLimitConfig,
  type ClientRateLimitStatus,
  type ClientIdentification,
  identifyClient,
  setClientRateLimit,
  checkClientRateLimit,
  listClientRateLimitStatuses,
  clearClientBlock,
} from "./client-rate-limits.js";
// Adaptive Guard
export {
  type AdaptiveState,
  type AdaptiveStrictnessLevel,
  getAdaptiveState,
  adjustAdaptiveLevel,
  applyAdaptiveStrictness,
} from "./adaptive-guard.js";
// Denylist
export {
  type DenylistEntry,
  addDenylistEntry,
  deleteDenylistEntry,
  listDenylistEntries,
  isIPBlocked,
} from "./denylist.js";
// Replay detector
export {
  type ReplayCheckResult,
  type ReplayConfig,
  checkReplay,
  clearReplayWindow,
} from "./replay-detector.js";
// Data classifier
export {
  type SensitivityLevel,
  type ClassificationResult,
  classifyContent,
  classifyBatch,
  sensitivityLabel,
} from "./data-classifier.js";
// Workspace Quotas
export {
  type QuotaConfig,
  type QuotaStatus,
  type QuotaUsage,
  setWorkspaceQuota,
  checkWorkspaceQuota,
  recordQuotaUsage,
  getWorkspaceQuotaUsage,
  listWorkspaceQuotas,
  deleteWorkspaceQuota,
} from "./workspace-quotas.js";
// Streaming Toxicity Guard
export {
  type ToxicityMatch,
  type StreamingToxicityConfig,
  type CombinedStreamingConfig,
  scanToxicity,
  streamToxicityGuard,
  checkTextToxicity,
  streamCombinedGuard,
} from "./streaming-toxicity.js";
// Guardrails Metrics (Prometheus)
export {
  type GuardrailsMetrics,
  type PrometheusTextOutput,
  toPrometheusTextFormat,
  exportGuardrailsMetrics,
  exportGuardrailsMetricsJSON,
} from "./guardrails-metrics.js";
// Guardrails Analytics (Dashboard)
export {
  type GuardAnalyticsSummary,
  type GuardTrend,
  type GuardTrendDataPoint,
  type RuleEffectiveness,
  type TopViolation,
  getGuardAnalyticsSummary,
  getGuardTrend,
} from "./guard-analytics.js";
// Shadow mode — evaluate without blocking
export {
  evaluateShadowMode,
  getShadowModeStats,
  listShadowEvaluations,
  type ShadowEvaluation,
  type ShadowViolation,
  type ShadowModeStats,
} from "./shadow-mode.js";
