#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createFlag, listFlags, updateFlag, deleteFlag, setOverride, getFlag, getFlagByKey, addRule, listRules, getFlagHistory } from "../lib/flags.js";
import { evaluateFlag, evaluateAllFlags } from "../lib/evaluate.js";
import { createExperiment, listExperiments, assignVariant } from "../lib/experiments.js";

const server = new Server({ name: "microservice-flags", version: "0.0.1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: "flags_list_flags", description: "List all flags", inputSchema: { type: "object", properties: { workspace_id: { type: "string" } }, required: [] } },
  { name: "flags_create_flag", description: "Create a feature flag", inputSchema: { type: "object", properties: { key: { type: "string" }, name: { type: "string" }, type: { type: "string" }, default_value: { type: "string" } }, required: ["key", "name"] } },
  { name: "flags_evaluate", description: "Evaluate a flag for a user/context", inputSchema: { type: "object", properties: { key: { type: "string" }, user_id: { type: "string" }, workspace_id: { type: "string" } }, required: ["key"] } },
  { name: "flags_evaluate_all", description: "Evaluate all flags for a context", inputSchema: { type: "object", properties: { user_id: { type: "string" }, workspace_id: { type: "string" } }, required: [] } },
  { name: "flags_set_override", description: "Override a flag for a user or workspace", inputSchema: { type: "object", properties: { flag_id: { type: "string" }, target_type: { type: "string" }, target_id: { type: "string" }, value: { type: "string" } }, required: ["flag_id", "target_type", "target_id", "value"] } },
  { name: "flags_toggle", description: "Enable or disable a flag", inputSchema: { type: "object", properties: { id: { type: "string" }, enabled: { type: "boolean" } }, required: ["id", "enabled"] } },
  { name: "flags_list_experiments", description: "List experiments", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "flags_create_experiment", description: "Create an A/B experiment", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name"] } },
  { name: "flags_assign_variant", description: "Get or assign experiment variant for a user", inputSchema: { type: "object", properties: { experiment_id: { type: "string" }, user_id: { type: "string" } }, required: ["experiment_id", "user_id"] } },
  { name: "flags_delete_flag", description: "Delete a feature flag", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "flags_get_flag", description: "Get a flag by id or key", inputSchema: { type: "object", properties: { id: { type: "string" }, key: { type: "string" } }, required: [] } },
  { name: "flags_add_rule", description: "Add a targeting rule to a flag", inputSchema: { type: "object", properties: { flag_id: { type: "string" }, name: { type: "string" }, type: { type: "string" }, config: { type: "object" }, value: { type: "string" }, priority: { type: "number" } }, required: ["flag_id", "type", "config", "value"] } },
  { name: "flags_list_rules", description: "List rules for a flag", inputSchema: { type: "object", properties: { flag_id: { type: "string" } }, required: ["flag_id"] } },
  { name: "flags_get_history", description: "Get change history for a flag", inputSchema: { type: "object", properties: { flag_id: { type: "string" }, limit: { type: "number" } }, required: ["flag_id"] } },
]}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb(); const { name, arguments: args } = req.params; const a = args as Record<string, unknown>;
  const t = (d: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }] });
  if (name === "flags_list_flags") return t(await listFlags(sql, a.workspace_id as string | undefined));
  if (name === "flags_create_flag") return t(await createFlag(sql, { key: String(a.key), name: String(a.name), type: a.type as string | undefined, defaultValue: a.default_value as string | undefined }));
  if (name === "flags_evaluate") return t(await evaluateFlag(sql, String(a.key), { userId: a.user_id as string, workspaceId: a.workspace_id as string }));
  if (name === "flags_evaluate_all") return t(await evaluateAllFlags(sql, a.workspace_id as string, { userId: a.user_id as string, workspaceId: a.workspace_id as string }));
  if (name === "flags_set_override") return t(await setOverride(sql, String(a.flag_id), a.target_type as "user"|"workspace", String(a.target_id), String(a.value)));
  if (name === "flags_toggle") return t(await updateFlag(sql, String(a.id), { enabled: Boolean(a.enabled) }));
  if (name === "flags_list_experiments") return t(await listExperiments(sql));
  if (name === "flags_create_experiment") return t(await createExperiment(sql, { name: String(a.name), description: a.description as string | undefined }));
  if (name === "flags_assign_variant") return t({ variant: await assignVariant(sql, String(a.experiment_id), String(a.user_id)) });
  if (name === "flags_delete_flag") return t({ deleted: await deleteFlag(sql, String(a.id)) });
  if (name === "flags_get_flag") {
    if (a.id) return t(await getFlag(sql, String(a.id)));
    if (a.key) return t(await getFlagByKey(sql, String(a.key)));
    return t(null);
  }
  if (name === "flags_add_rule") return t(await addRule(sql, String(a.flag_id), { name: a.name as string | undefined, type: String(a.type), config: a.config as Record<string, unknown>, value: String(a.value), priority: a.priority as number | undefined }));
  if (name === "flags_list_rules") return t(await listRules(sql, String(a.flag_id)));
  if (name === "flags_get_history") return t(await getFlagHistory(sql, String(a.flag_id), a.limit as number | undefined));
  throw new Error(`Unknown tool: ${name}`);
});

async function main() { const sql = getDb(); await migrate(sql); await server.connect(new StdioServerTransport()); }
main().catch(console.error);
