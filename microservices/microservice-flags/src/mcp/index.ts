#!/usr/bin/env bun
/**
 * MCP server for microservice-flags.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { evaluateAllFlags, evaluateFlag } from "../lib/evaluate.js";
import {
  assignVariant,
  createExperiment,
  listExperiments,
} from "../lib/experiments.js";
import {
  addRule,
  createFlag,
  deleteFlag,
  getFlag,
  getFlagByKey,
  getFlagHistory,
  listFlags,
  listRules,
  setOverride,
  updateFlag,
} from "../lib/flags.js";

const server = new McpServer({
  name: "microservice-flags",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  "flags_list_flags",
  "List all flags",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) => text(await listFlags(sql, workspace_id)),
);

server.tool(
  "flags_create_flag",
  "Create a feature flag",
  {
    key: z.string(),
    name: z.string(),
    type: z.string().optional().default("boolean"),
    default_value: z.string().optional().default("false"),
  },
  async ({ default_value, ...rest }) =>
    text(
      await createFlag(sql, {
        defaultValue: default_value,
        ...rest,
      }),
    ),
);

server.tool(
  "flags_evaluate",
  "Evaluate a flag for a user/context",
  {
    key: z.string(),
    user_id: z.string().optional(),
    workspace_id: z.string().optional(),
  },
  async ({ key, user_id, workspace_id }) =>
    text(
      await evaluateFlag(sql, key, {
        userId: user_id,
        workspaceId: workspace_id,
      }),
    ),
);

server.tool(
  "flags_evaluate_all",
  "Evaluate all flags for a context",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
  },
  async ({ workspace_id, user_id }) =>
    text(
      await evaluateAllFlags(sql, workspace_id, {
        userId: user_id,
        workspaceId: workspace_id,
      }),
    ),
);

server.tool(
  "flags_set_override",
  "Override a flag for a user or workspace",
  {
    flag_id: z.string(),
    target_type: z.enum(["user", "workspace"]),
    target_id: z.string(),
    value: z.string(),
  },
  async (overrideData) => text(await setOverride(sql, overrideData.flag_id, overrideData.target_type, overrideData.target_id, overrideData.value)),
);

server.tool(
  "flags_toggle",
  "Enable or disable a flag",
  {
    id: z.string(),
    enabled: z.boolean(),
  },
  async ({ id, enabled }) => text(await updateFlag(sql, id, { enabled })),
);

server.tool(
  "flags_list_experiments",
  "List experiments",
  {},
  async () => text(await listExperiments(sql)),
);

server.tool(
  "flags_create_experiment",
  "Create an A/B experiment",
  {
    name: z.string(),
    description: z.string().optional(),
  },
  async (expData) => text(await createExperiment(sql, expData)),
);

server.tool(
  "flags_assign_variant",
  "Get or assign experiment variant for a user",
  {
    experiment_id: z.string(),
    user_id: z.string(),
  },
  async ({ experiment_id, user_id }) =>
    text({
      variant: await assignVariant(sql, experiment_id, user_id),
    }),
);

server.tool(
  "flags_delete_flag",
  "Delete a feature flag",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteFlag(sql, id) }),
);

server.tool(
  "flags_get_flag",
  "Get a flag by id or key",
  {
    id: z.string().optional(),
    key: z.string().optional(),
  },
  async ({ id, key }) => {
    if (id) return text(await getFlag(sql, id));
    if (key) return text(await getFlagByKey(sql, key));
    return text({ error: "Either id or key must be provided" });
  },
);

server.tool(
  "flags_add_rule",
  "Add a targeting rule to a flag",
  {
    flag_id: z.string(),
    name: z.string().optional(),
    type: z.string(),
    config: z.record(z.any()),
    value: z.string(),
    priority: z.number().optional(),
  },
  async ({ flag_id, ...ruleData }) => text(await addRule(sql, flag_id, ruleData)),
);

server.tool(
  "flags_list_rules",
  "List rules for a flag",
  { flag_id: z.string() },
  async ({ flag_id }) => text(await listRules(sql, flag_id)),
);

server.tool(
  "flags_get_history",
  "Get change history for a flag",
  {
    flag_id: z.string(),
    limit: z.number().optional().default(20),
  },
  async ({ flag_id, limit }) => text(await getFlagHistory(sql, flag_id, limit)),
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
