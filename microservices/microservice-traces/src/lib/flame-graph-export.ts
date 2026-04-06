/**
 * Flame graph export in multiple formats for trace visualization.
 */

import type { SpanWithChildren } from "./query.js";

/**
 * Speedscope-compatible profile format.
 * Speedscope is a visual flame graph tool at speedscope.app
 */
export interface SpeedscopeProfile {
  version: string;
  fileType: string;
  environment: {
    name: string;
    project: string;
  };
  profiles: SpeedscopeProfileEntry[];
}

export interface SpeedscopeProfileEntry {
  type: "evented" | "sample";
  name: string;
  unit: string;
  startValue: number;
  endValue: number;
  events?: SpeedscopeEvent[];
  samples?: SpeedscopeSample[];
}

export interface SpeedscopeEvent {
  type: "O" | "C";
  timestamp: number;
  payload?: { name?: string; cat?: string };
}

export interface SpeedscopeSample {
  weight: number;
  timestamp: number;
  stack?: string[];
}

export interface CollapsedStackLine {
  stack: string;
  value: number;
}

/**
 * Convert a trace flame graph to Speedscope JSON format.
 */
export function exportFlameGraphAsSpeedscope(
  spans: SpanWithChildren[],
  traceStartedAt: Date,
): SpeedscopeProfile {
  const startMs = traceStartedAt.getTime();

  function buildEntries(node: SpanWithChildren): SpeedscopeProfileEntry[] {
    const entries: SpeedscopeProfileEntry[] = [];
    const selfStart = node.started_at ? new Date(node.started_at).getTime() - startMs : 0;
    const selfEnd = node.ended_at ? new Date(node.ended_at).getTime() - startMs : selfStart + (node.duration_ms ?? 0);

    const events: SpeedscopeEvent[] = [
      { type: "O" as const, timestamp: selfStart, payload: { name: node.name, cat: node.type } },
    ];

    for (const child of node.children) {
      events.push(...buildEntries(child).flatMap(e => e.events ?? []).map(e => ({
        ...e,
        timestamp: e.timestamp, // timestamps already relative
      })));
    }

    events.push({ type: "C" as const, timestamp: selfEnd });

    entries.push({
      type: "evented",
      name: node.name,
      unit: "milliseconds",
      startValue: selfStart,
      endValue: selfEnd,
      events,
    });

    return entries;
  }

  const allEntries: SpeedscopeProfileEntry[] = [];
  for (const span of spans) {
    allEntries.push(...buildEntries(span));
  }

  return {
    version: "0.1",
    fileType: "speedscope",
    environment: {
      name: "microservice-traces",
      project: "llm-traces",
    },
    profiles: allEntries,
  };
}

/**
 * Export flame graph as collapsed stack format (used by Perf, FlameGraph, speedscope)
 * Each line: "root;child1;child2 leaf value"
 */
export function exportFlameGraphAsCollapsedStack(
  spans: SpanWithChildren[],
  valueField: "duration_ms" | "tokens_in" | "tokens_out" = "duration_ms",
): CollapsedStackLine[] {
  const stackMap = new Map<string, number>();

  function walk(node: SpanWithChildren, path: string[]) {
    const currentPath = [...path, `${node.name} (${node.type})`];
    const value = Number(node[valueField] ?? 0);

    // Aggregate all paths
    const stackKey = currentPath.join(";");
    stackMap.set(stackKey, (stackMap.get(stackKey) ?? 0) + value);

    for (const child of node.children) {
      walk(child, currentPath);
    }
  }

  for (const span of spans) {
    walk(span, []);
  }

  return Array.from(stackMap.entries())
    .map(([stack, value]) => ({ stack, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Export flame graph as speedscope from a tree built from spans.
 */
export function exportTraceFlameGraphAsSpeedscope(
  spanTree: SpanWithChildren,
): SpeedscopeProfile {
  return exportFlameGraphAsSpeedscope([spanTree], new Date(spanTree.started_at ?? Date.now()));
}