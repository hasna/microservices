#!/usr/bin/env bun
/**
 * MCP server for microservice-traces.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { getTrace, getTraceTree, listTraces } from "../lib/query.js";
import { getTraceStats } from "../lib/stats.js";
import { endSpan, endTrace, startSpan, startTrace } from "../lib/tracing.js";

const server = new Server(
  { name: "microservice-traces", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "traces_start_trace",
      description: "Start a new trace for tracking an LLM operation",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          name: {
            type: "string",
            description: "Trace name (e.g. chat, completion)",
          },
          input: { type: "object", description: "Input data" },
          metadata: { type: "object", description: "Arbitrary metadata" },
        },
        required: ["workspace_id", "name"],
      },
    },
    {
      name: "traces_end_trace",
      description:
        "End a trace and compute aggregated metrics from child spans",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
          status: { type: "string", enum: ["completed", "error"] },
          output: { type: "object", description: "Output data" },
          error: {
            type: "string",
            description: "Error message if status is error",
          },
        },
        required: ["id", "status"],
      },
    },
    {
      name: "traces_start_span",
      description: "Start a new span within a trace",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Parent trace ID" },
          parent_span_id: {
            type: "string",
            description: "Parent span ID for nesting",
          },
          name: { type: "string", description: "Span name" },
          type: {
            type: "string",
            enum: [
              "llm",
              "tool",
              "retrieval",
              "guardrail",
              "embedding",
              "custom",
            ],
            description: "Span type",
          },
          input: { type: "object", description: "Input data" },
          model: { type: "string", description: "Model name (for llm spans)" },
          metadata: { type: "object", description: "Arbitrary metadata" },
        },
        required: ["trace_id", "name", "type"],
      },
    },
    {
      name: "traces_end_span",
      description: "End a span with results and token usage",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Span ID" },
          status: { type: "string", enum: ["completed", "error"] },
          output: { type: "object", description: "Output data" },
          error: { type: "string", description: "Error message" },
          tokens_in: { type: "number", description: "Input tokens" },
          tokens_out: { type: "number", description: "Output tokens" },
          cost_usd: { type: "number", description: "Cost in USD" },
        },
        required: ["id", "status"],
      },
    },
    {
      name: "traces_get_trace",
      description: "Get a trace with all its spans (flat list)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_list_traces",
      description: "List traces for a workspace with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          status: { type: "string", enum: ["running", "completed", "error"] },
          name: { type: "string", description: "Filter by name (ILIKE)" },
          since: { type: "string", description: "ISO date string" },
          until: { type: "string", description: "ISO date string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_get_stats",
      description: "Get trace statistics for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: {
            type: "string",
            description: "ISO date string (default: 30 days ago)",
          },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_get_trace_tree",
      description:
        "Get a trace with spans nested as a tree (children[] on each span)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
        },
        required: ["id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as any;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "traces_start_trace") {
    return text(
      await startTrace(sql, {
        workspaceId: String(a.workspace_id),
        name: String(a.name),
        input: a.input,
        metadata: a.metadata as any | undefined,
      }),
    );
  }

  if (name === "traces_end_trace") {
    return text(
      await endTrace(sql, String(a.id), {
        status: a.status as "completed" | "error",
        output: a.output,
        error: a.error ? String(a.error) : undefined,
      }),
    );
  }

  if (name === "traces_start_span") {
    return text(
      await startSpan(sql, {
        traceId: String(a.trace_id),
        parentSpanId: a.parent_span_id ? String(a.parent_span_id) : undefined,
        name: String(a.name),
        type: String(a.type) as
          | "llm"
          | "tool"
          | "retrieval"
          | "guardrail"
          | "embedding"
          | "custom",
        input: a.input,
        model: a.model ? String(a.model) : undefined,
        metadata: a.metadata as any | undefined,
      }),
    );
  }

  if (name === "traces_end_span") {
    return text(
      await endSpan(sql, String(a.id), {
        status: a.status as "completed" | "error",
        output: a.output,
        error: a.error ? String(a.error) : undefined,
        tokens_in: a.tokens_in ? Number(a.tokens_in) : undefined,
        tokens_out: a.tokens_out ? Number(a.tokens_out) : undefined,
        cost_usd: a.cost_usd ? Number(a.cost_usd) : undefined,
      }),
    );
  }

  if (name === "traces_get_trace") {
    const trace = await getTrace(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    return text(trace);
  }

  if (name === "traces_list_traces") {
    return text(
      await listTraces(sql, String(a.workspace_id), {
        status: a.status ? String(a.status) : undefined,
        name: a.name ? String(a.name) : undefined,
        since: a.since ? new Date(String(a.since)) : undefined,
        until: a.until ? new Date(String(a.until)) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
        offset: a.offset ? Number(a.offset) : undefined,
      }),
    );
  }

  if (name === "traces_get_stats") {
    return text(
      await getTraceStats(
        sql,
        String(a.workspace_id),
        a.since ? new Date(String(a.since)) : undefined,
      ),
    );
  }

  if (name === "traces_get_trace_tree") {
    const trace = await getTraceTree(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    return text(trace);
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
