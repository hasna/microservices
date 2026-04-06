/**
 * Structured function calling — OpenAI tool/function calling + Anthropic tool use.
 * Enables LLMs to invoke registered tools and return structured results.
 */

import type { Sql } from "postgres";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  call_id: string;
  name: string;
  result: unknown;
  error?: string;
}

export interface FunctionCallResponse {
  content: string;
  tool_calls: ToolCall[];
  model: string;
  provider: string;
}

/**
 * Store tool definitions for a workspace.
 */
export async function registerTools(
  sql: Sql,
  workspaceId: string,
  tools: ToolDefinition[],
): Promise<{ registered: number }> {
  for (const tool of tools) {
    await sql`
      INSERT INTO llm.workspace_tools (workspace_id, name, description, parameters)
      VALUES (${workspaceId}, ${tool.name}, ${tool.description}, ${JSON.stringify(tool.parameters)})
      ON CONFLICT (workspace_id, name) DO UPDATE SET
        description = EXCLUDED.description,
        parameters = EXCLUDED.parameters
    `;
  }
  return { registered: tools.length };
}

/**
 * List registered tools for a workspace.
 */
export async function listTools(
  sql: Sql,
  workspaceId: string,
): Promise<ToolDefinition[]> {
  const rows = await sql<any[]>`
    SELECT name, description, parameters FROM llm.workspace_tools
    WHERE workspace_id = ${workspaceId}
    ORDER BY name ASC
  `;
  return rows.map((r) => ({
    name: r.name,
    description: r.description,
    parameters: r.parameters,
  }));
}

/**
 * Delete a tool from a workspace.
 */
export async function deleteTool(
  sql: Sql,
  workspaceId: string,
  name: string,
): Promise<boolean> {
  const [{ count }] = await sql<{ count: string }[]>`
    DELETE FROM llm.workspace_tools
    WHERE workspace_id = ${workspaceId} AND name = ${name}
    RETURNING count(*) as count
  `;
  return parseInt(count) > 0;
}

/**
 * Parse tool calls from an OpenAI function call response.
 */
export function parseToolCalls(
  choices: any[],
): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const choice of choices) {
    const message = choice.message;
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.function) {
          calls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments ?? "{}"),
          });
        }
      }
    }
  }
  return calls;
}

/**
 * Build an OpenAI tool payload from ToolDefinition array.
 */
export function buildOpenAITools(
  tools: ToolDefinition[],
): { type: "function"; function: { name: string; description: string; parameters: any } }[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Execute a tool call by name, routing to registered handlers.
 * Returns the result of the tool execution.
 *
 * Usage: const result = await executeToolCall(sql, workspaceId, call, handlers);
 */
export async function executeToolCall(
  sql: Sql,
  workspaceId: string,
  call: ToolCall,
  handlers: Record<string, (args: Record<string, unknown>, sql: Sql) => Promise<unknown>>,
): Promise<ToolCallResult> {
  const handler = handlers[call.name];
  if (!handler) {
    return {
      call_id: call.id,
      name: call.name,
      result: null,
      error: `No handler registered for tool: ${call.name}`,
    };
  }

  try {
    const result = await handler(call.arguments, sql);
    return { call_id: call.id, name: call.name, result };
  } catch (err) {
    return {
      call_id: call.id,
      name: call.name,
      result: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Execute multiple tool calls in parallel.
 */
export async function executeToolCallsParallel(
  sql: Sql,
  workspaceId: string,
  calls: ToolCall[],
  handlers: Record<string, (args: Record<string, unknown>, sql: Sql) => Promise<unknown>>,
): Promise<ToolCallResult[]> {
  return Promise.all(
    calls.map((call) => executeToolCall(sql, workspaceId, call, handlers)),
  );
}
