#!/usr/bin/env bun
/**
 * MCP server for microservice-guardrails.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { addAllowlistEntry, deleteAllowlistEntry, listAllowlistEntries } from "../lib/allowlist.js";
import {
  type AuditLogEntry,
  logAuditEntry,
  queryAuditLog,
  getAuditStats,
  pruneAuditLog,
} from "../lib/audit.js";
import { exportAuditLogJSON, exportAuditLogCSV } from "../lib/audit-export.js";
import {
  computeSimhash,
  hammingDistance,
  isNearDuplicate,
  findNearDuplicates,
  computeAverageHash,
  storeFingerprint,
  getFingerprint,
  listFingerprints,
  deleteFingerprint,
} from "../lib/fingerprint.js";
import {
  addGuardRule,
  deleteGuardRule,
  evaluateDSLRule,
  listGuardRules,
  toggleGuardRule,
  updateGuardRule,
  validateDSLPattern,
} from "../lib/dsl-rules.js";
import { checkInput, checkOutput, checkInputStream, checkOutputStream } from "../lib/guard.js";
import { detectPromptInjection } from "../lib/injection.js";
import {
  inspectFull,
  scanPII,
  detectIPAddress,
  detectDateOfBirth,
  detectLicensePlate,
  detectMedicalLicense,
} from "../lib/pii.js";
import { checkToxicity } from "../lib/toxicity.js";
import { createPolicy, deletePolicy, evaluatePolicy, listPolicies } from "../lib/policy.js";
import { redactStreamText, streamGuard } from "../lib/stream-guard.js";
import { listViolations, logViolation } from "../lib/violations.js";
import {
  addDenylistEntry,
  deleteDenylistEntry,
  listDenylistEntries,
  isIPBlocked,
} from "../lib/denylist.js";
import {
  checkReplay,
  clearReplayWindow,
  type ReplayConfig,
} from "../lib/replay-detector.js";
import {
  identifyClient,
  setClientRateLimit,
  checkClientRateLimit,
  listClientRateLimitStatuses,
  clearClientBlock,
} from "../lib/client-rate-limits.js";
import {
  classifyContent,
  classifyBatch,
  sensitivityLabel,
} from "../lib/data-classifier.js";
import {
  createRuleVersion,
  getRuleVersion,
  listRuleVersions,
  getLatestRuleVersion,
  rollbackRule,
} from "../lib/rule-versioning.js";
import {
  createRuleGroup,
  evaluateRuleGroup,
  listRuleGroups,
} from "../lib/guard-policies.js";
import {
  getAdaptiveState,
  adjustAdaptiveLevel,
  applyAdaptiveStrictness,
} from "../lib/adaptive-guard.js";
import {
  scanToxicity,
  streamCombinedGuard,
  streamToxicityGuard,
} from "../lib/streaming-toxicity.js";
import {
  getGuardAnalyticsSummary,
  getGuardTrend,
} from "../lib/guard-analytics.js";
import {
  evaluateShadowMode,
  getShadowModeStats,
  listShadowEvaluations,
} from "../lib/index.js";
import { redactPII } from "../lib/pii.js";
import { evaluateGuardRules } from "../lib/dsl-rules.js";
import { getRuleVersionDiff, pruneRuleVersions, compareRuleVersions } from "../lib/rule-versioning.js";
import { checkWorkspaceQuota, recordQuotaUsage, getWorkspaceQuotaUsage, deleteWorkspaceQuota } from "../lib/workspace-quotas.js";
import { exportGuardrailsMetrics, exportGuardrailsMetricsJSON } from "../lib/guardrails-metrics.js";

const server = new McpServer({
  name: "microservice-guardrails",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

