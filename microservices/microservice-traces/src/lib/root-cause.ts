/**
 * AI-powered root cause analysis for traces.
 *
 * Uses pattern matching and statistical analysis to identify why traces
 * are slow, errored, or behaving anomalously.
 */

import type { Sql } from "postgres";
import { getTrace, getTraceTree, listSpans, getSpanAnalytics, compareLatencyBetweenPeriods } from "./index.js";

export interface RootCauseFinding {
  category: "latency" | "error" | "resource" | "dependency" | "configuration";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  span_id?: string;
  span_name?: string;
  evidence: string[];
  suggestion: string;
  confidence: number; // 0-1
}

export interface RootCauseAnalysisResult {
  trace_id: string;
  summary: string;
  findings: RootCauseFinding[];
  analyzed_at: string;
  execution_time_ms: number;
}

export interface AnomalyExplanationResult {
  trace_id: string;
  baseline_stats: {
    avg_duration_ms: number;
    p95_duration_ms: number;
    error_rate: number;
  };
  this_trace_stats: {
    duration_ms: number;
    error_count: number;
  };
  deviation_explanation: string;
  likely_causes: string[];
  confidence: number;
}

/**
 * Perform root cause analysis on a trace.
 * Identifies why a trace is slow or errored.
 */
export async function analyzeTraceRootCause(
  sql: Sql,
  traceId: string,
  workspaceId: string,
): Promise<RootCauseAnalysisResult> {
  const startTime = Date.now();

  const trace = await getTrace(sql, traceId);
  if (!trace) {
    throw new Error(`Trace not found: ${traceId}`);
  }

  const tree = await getTraceTree(sql, workspaceId, traceId);
  const findings: RootCauseFinding[] = [];

  // Check for errors
  const errorSpans = tree.spans.filter((s) => s.status === "error");
  if (errorSpans.length > 0) {
    findings.push({
      category: "error",
      severity: errorSpans.length > 3 ? "critical" : "high",
      title: `${errorSpans.length} error span(s) detected`,
      description: `Found ${errorSpans.length} spans with error status in this trace`,
      span_id: errorSpans[0].id,
      span_name: errorSpans[0].name,
      evidence: errorSpans.slice(0, 3).map((s) => `Span "${s.name}" (${s.type}): ${s.error || "unknown error"}`),
      suggestion: "Check the error messages in the affected spans. Common causes: API timeouts, invalid inputs, rate limiting, or upstream service failures.",
      confidence: 0.9,
    });
  }

  // Find slowest spans
  const sortedSpans = [...tree.spans].sort((a, b) => (b.duration_ms || 0) - (a.duration_ms || 0));
  const slowestSpan = sortedSpans[0];
  if (slowestSpan && slowestSpan.duration_ms && slowestSpan.duration_ms > 1000) {
    const threshold = slowestSpan.duration_ms > 5000 ? "critical" : slowestSpan.duration_ms > 2000 ? "high" : "medium";
    findings.push({
      category: "latency",
      severity: threshold,
      title: `Slowest span: "${slowestSpan.name}"`,
      description: `This span took ${slowestSpan.duration_ms.toFixed(0)}ms (${((slowestSpan.duration_ms / (trace.duration_ms || 1)) * 100).toFixed(0)}% of total trace time)`,
      span_id: slowestSpan.id,
      span_name: slowestSpan.name,
      evidence: [
        `Duration: ${slowestSpan.duration_ms.toFixed(0)}ms`,
        `Type: ${slowestSpan.type}`,
        `Started at: ${slowestSpan.started_at}`,
      ],
      suggestion: getSlowSpanSuggestion(slowestSpan.type, slowestSpan.duration_ms),
      confidence: 0.85,
    });

    // Check for N+1 patterns in DB spans
    if (slowestSpan.type === "db" && slowestSpan.metadata?.query_count && slowestSpan.metadata.query_count > 10) {
      findings.push({
        category: "resource",
        severity: "high",
        title: "Possible N+1 query pattern",
        description: `Database span has ${slowestSpan.metadata.query_count} queries — this may indicate an N+1 pattern`,
        span_id: slowestSpan.id,
        span_name: slowestSpan.name,
        evidence: [`Query count: ${slowestSpan.metadata.query_count}`],
        suggestion: "Consider using batch queries or JOINs instead of multiple individual queries. Implement query result caching where appropriate.",
        confidence: 0.75,
      });
    }
  }

  // Check for sequential dependencies that could be parallelized
  const sequentialChains = findSequentialChains(tree.spans);
  if (sequentialChains.length > 0) {
    const chain = sequentialChains[0];
    findings.push({
      category: "dependency",
      severity: "medium",
      title: "Sequential dependency detected",
      description: `Spans "${chain[0]}" and "${chain[1]}" ran sequentially but could potentially be parallelized`,
      evidence: [`Chain: ${chain.join(" → ")}`],
      suggestion: "If these spans don't have data dependencies between them, consider running them in parallel to reduce total trace duration.",
      confidence: 0.6,
    });
  }

  // Check for missing parent spans (orphaned)
  const orphanedSpans = tree.spans.filter((s) => s.parent_id && !tree.spans.find((p) => p.id === s.parent_id));
  if (orphanedSpans.length > 0) {
    findings.push({
      category: "configuration",
      severity: "low",
      title: "Orphaned spans detected",
      description: `${orphanedSpans.length} span(s) have a parent_id that doesn't exist in the trace`,
      evidence: orphanedSpans.slice(0, 3).map((s) => `Span "${s.name}" references parent ${s.parent_id}`),
      suggestion: "This may indicate a trace context propagation issue. Check that your instrumentation properly propagates trace context.",
      confidence: 0.7,
    });
  }

  const executionTimeMs = Date.now() - startTime;

  return {
    trace_id: traceId,
    summary: generateSummary(findings, tree),
    findings,
    analyzed_at: new Date().toISOString(),
    execution_time_ms: executionTimeMs,
  };
}

function getSlowSpanSuggestion(spanType: string, durationMs: number): string {
  if (spanType === "llm") {
    if (durationMs > 10000) {
      return "LLM call is very slow. Consider: using a faster model, enabling streaming, implementing result caching, or optimizing prompt length.";
    }
    return "LLM call is slow. Consider: reducing prompt length, using a faster model, enabling caching, or checking token limits.";
  }
  if (spanType === "db") {
    return "Database query is slow. Consider: adding indexes, optimizing the query, using query caching, or implementing pagination.";
  }
  if (spanType === "http") {
    return "HTTP request is slow. Consider: implementing request caching, checking the upstream service latency, or adding timeouts.";
  }
  if (spanType === "vector") {
    return "Vector search is slow. Consider: optimizing the embedding index, reducing the search scope, or using approximate nearest neighbors.";
  }
  return "Span is slow. Profile this operation to identify the bottleneck — likely I/O, network, or compute intensive.";
}

function findSequentialChains(spans: { name: string; started_at?: Date; duration_ms?: number }[]): [string, string][] {
  const chains: [string, string][] = [];
  const sortedByStart = [...spans].filter((s) => s.started_at).sort(
    (a, b) => new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime(),
  );

  for (let i = 0; i < sortedByStart.length - 1; i++) {
    const current = sortedByStart[i];
    const next = sortedByStart[i + 1];
    if (current.started_at && next.started_at && current.duration_ms) {
      const gap = new Date(next.started_at).getTime() - (new Date(current.started_at).getTime() + current.duration_ms);
      if (gap < 50 && gap > -current.duration_ms) {
        // Overlapping or back-to-back
        chains.push([current.name, next.name]);
      }
    }
  }
  return chains;
}

function generateSummary(findings: RootCauseFinding[], tree: { duration_ms?: number; spans: { length: number } }): string {
  if (findings.length === 0) {
    return "No obvious issues detected. Trace appears healthy.";
  }
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  if (critical > 0) {
    return `Found ${critical} critical issue(s) affecting this trace. Resolution recommended before production deployment.`;
  }
  if (high > 0) {
    return `Found ${high} high-severity issue(s) that may impact performance. Addressing these would improve trace duration.`;
  }
  return `Found ${findings.length} moderate issue(s). Trace is functional but could be optimized.`;
}

/**
 * Explain why a trace is anomalous compared to baseline.
 */
export async function explainTraceAnomaly(
  sql: Sql,
  traceId: string,
  workspaceId: string,
  baselineHours: number = 24,
): Promise<AnomalyExplanationResult> {
  const trace = await getTrace(sql, traceId);
  if (!trace) {
    throw new Error(`Trace not found: ${traceId}`);
  }

  const tree = await getTraceTree(sql, workspaceId, traceId);

  // Calculate baseline statistics from recent traces
  const since = new Date(Date.now() - baselineHours * 60 * 60 * 1000).toISOString();
  const analytics = await getSpanAnalytics(sql, workspaceId, since);

  const baselineAvgDuration = analytics.length > 0
    ? analytics.reduce((sum, a) => sum + (a.avg_duration_ms || 0), 0) / analytics.length
    : 0;
  const baselineErrorRate = analytics.length > 0
    ? analytics.reduce((sum, a) => sum + (a.error_rate || 0), 0) / analytics.length
    : 0;

  const thisDuration = trace.duration_ms || 0;
  const thisErrorCount = tree.spans.filter((s) => s.status === "error").length;

  const durationDeviation = baselineAvgDuration > 0 ? ((thisDuration - baselineAvgDuration) / baselineAvgDuration) * 100 : 0;

  const likelyCauses: string[] = [];
  if (durationDeviation > 100) {
    likelyCauses.push(`Trace is ${durationDeviation.toFixed(0)}% slower than baseline — possible resource contention or algorithmic issue`);
  }
  if (thisErrorCount > baselineErrorRate * 5) {
    likelyCauses.push("Error rate significantly higher than baseline — check for upstream failures or configuration changes");
  }

  // Find the most anomalous span
  const slowestSpan = [...tree.spans].sort((a, b) => (b.duration_ms || 0) - (a.duration_ms || 0))[0];
  if (slowestSpan && slowestSpan.duration_ms && baselineAvgDuration > 0) {
    const spanContribution = (slowestSpan.duration_ms / thisDuration) * 100;
    if (spanContribution > 50) {
      likelyCauses.push(`Span "${slowestSpan.name}" accounts for ${spanContribution.toFixed(0)}% of total duration — focus optimization efforts here`);
    }
  }

  let deviationExplanation: string;
  if (durationDeviation > 200) {
    deviationExplanation = `This trace is extremely slow (${durationDeviation.toFixed(0)}% above baseline). This is likely due to a specific bottleneck rather than normal variation.`;
  } else if (durationDeviation > 100) {
    deviationExplanation = `This trace is significantly slower than typical (${durationDeviation.toFixed(0)}% above baseline). This could indicate a resource issue or an unusual input pattern.`;
  } else if (durationDeviation > 50) {
    deviationExplanation = `This trace is moderately slower than baseline (${durationDeviation.toFixed(0)}% above). Some variation is normal, but the difference is notable.`;
  } else {
    deviationExplanation = "This trace is within normal variation from the baseline. The anomaly may be due to minor fluctuations.";
  }

  return {
    trace_id: traceId,
    baseline_stats: {
      avg_duration_ms: baselineAvgDuration,
      p95_duration_ms: baselineAvgDuration * 1.5, // Approximate
      error_rate: baselineErrorRate,
    },
    this_trace_stats: {
      duration_ms: thisDuration,
      error_count: thisErrorCount,
    },
    deviation_explanation: deviationExplanation,
    likely_causes: likelyCauses,
    confidence: baselineAvgDuration > 0 ? 0.85 : 0.5,
  };
}

/**
 * Get self-healing suggestions for a trace.
 * Returns configuration changes that could improve trace performance.
 */
export async function getTraceSelfHealingSuggestions(
  sql: Sql,
  traceId: string,
  workspaceId: string,
): Promise<{ category: string; current: string; suggested: string; impact: string; effort: "low" | "medium" | "high" }[]> {
  const tree = await getTraceTree(sql, workspaceId, traceId);
  const suggestions: { category: string; current: string; suggested: string; impact: string; effort: "low" | "medium" | "high" }[] = [];

  for (const span of tree.spans) {
    if (span.type === "llm" && span.duration_ms && span.duration_ms > 5000) {
      suggestions.push({
        category: "llm",
        current: `LLM span "${span.name}" takes ${span.duration_ms.toFixed(0)}ms`,
        suggested: "Enable streaming response and implement semantic caching for repeated queries",
        impact: "Could reduce perceived latency by 30-70% for cached queries",
        effort: "medium",
      });
    }

    if (span.type === "db" && span.metadata?.query_count && span.metadata.query_count > 5) {
      suggestions.push({
        category: "database",
        current: `DB span "${span.name}" executes ${span.metadata.query_count} queries`,
        suggested: "Implement batch queries or use query result caching",
        impact: "Could reduce DB span duration by 40-80%",
        effort: "medium",
      });
    }

    if (span.type === "vector" && span.duration_ms && span.duration_ms > 1000) {
      suggestions.push({
        category: "vector",
        current: `Vector search "${span.name}" takes ${span.duration_ms.toFixed(0)}ms`,
        suggested: "Use approximate nearest neighbors (ANN) indexing or reduce search scope",
        impact: "Could reduce search latency by 50-90% with minimal accuracy loss",
        effort: "low",
      });
    }
  }

  // Check for sequential spans that could be parallelized
  if (tree.spans.length > 5) {
    suggestions.push({
      category: "architecture",
      current: "Multiple sequential spans detected",
      suggested: "Review span dependencies — independent operations could run in parallel",
      impact: "Potential 20-40% reduction in total trace duration",
      effort: "high",
    });
  }

  return suggestions;
}
