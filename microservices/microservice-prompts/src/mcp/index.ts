#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createExperiment } from "../lib/experiments.js";
import { setOverride } from "../lib/overrides.js";
import {
  createPrompt,
  deletePrompt,
  listPrompts,
} from "../lib/prompts_crud.js";
import { resolvePrompt } from "../lib/resolve.js";
import {
  diffVersions,
  getVersion,
  listVersions,
  rollback,
  updatePrompt,
} from "../lib/versions.js";

const server = new Server(
  { name: "microservice-prompts", version: "0.0.1" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "prompts_create",
      description: "Create a new prompt with initial content",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          name: { type: "string" },
          content: { type: "string" },
          description: { type: "string" },
          model: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          created_by: { type: "string" },
        },
        required: ["workspace_id", "name", "content"],
      },
    },
    {
      name: "prompts_resolve",
      description:
        "Resolve a prompt (experiments → overrides → current version) and interpolate variables",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          name: { type: "string" },
          user_id: { type: "string" },
          agent_id: { type: "string" },
          variables: { type: "object" },
        },
        required: ["workspace_id", "name"],
      },
    },
    {
      name: "prompts_update",
      description: "Create a new version of a prompt",
      inputSchema: {
        type: "object",
        properties: {
          prompt_id: { type: "string" },
          content: { type: "string" },
          change_note: { type: "string" },
          created_by: { type: "string" },
          model: { type: "string" },
        },
        required: ["prompt_id", "content"],
      },
    },
    {
      name: "prompts_rollback",
      description: "Rollback prompt to a specific version",
      inputSchema: {
        type: "object",
        properties: {
          prompt_id: { type: "string" },
          version_number: { type: "number" },
        },
        required: ["prompt_id", "version_number"],
      },
    },
    {
      name: "prompts_list",
      description: "List prompts in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          search: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "prompts_list_versions",
      description: "List all versions of a prompt",
      inputSchema: {
        type: "object",
        properties: { prompt_id: { type: "string" } },
        required: ["prompt_id"],
      },
    },
    {
      name: "prompts_set_override",
      description: "Set a prompt override for a scope (user/agent/workspace)",
      inputSchema: {
        type: "object",
        properties: {
          prompt_id: { type: "string" },
          scope_type: { type: "string" },
          scope_id: { type: "string" },
          content: { type: "string" },
        },
        required: ["prompt_id", "scope_type", "scope_id", "content"],
      },
    },
    {
      name: "prompts_create_experiment",
      description: "Create an A/B experiment for a prompt",
      inputSchema: {
        type: "object",
        properties: {
          prompt_id: { type: "string" },
          name: { type: "string" },
          variants: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                version_id: { type: "string" },
                weight: { type: "number" },
              },
            },
          },
          traffic_pct: { type: "number" },
        },
        required: ["prompt_id", "name", "variants"],
      },
    },
    {
      name: "prompts_diff_versions",
      description: "Diff two versions of a prompt",
      inputSchema: {
        type: "object",
        properties: {
          prompt_id: { type: "string" },
          v1: { type: "number" },
          v2: { type: "number" },
        },
        required: ["prompt_id", "v1", "v2"],
      },
    },
    {
      name: "prompts_delete",
      description: "Delete a prompt and all its versions",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as any;
  const t = (d: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }],
  });

  if (name === "prompts_create") {
    return t(
      await createPrompt(sql, {
        workspaceId: String(a.workspace_id),
        name: String(a.name),
        content: String(a.content),
        description: a.description as string | undefined,
        model: a.model as string | undefined,
        tags: a.tags as string[] | undefined,
        createdBy: a.created_by as string | undefined,
      }),
    );
  }
  if (name === "prompts_resolve") {
    return t(
      await resolvePrompt(sql, String(a.workspace_id), String(a.name), {
        userId: a.user_id as string | undefined,
        agentId: a.agent_id as string | undefined,
        variables: a.variables as Record<string, string> | undefined,
      }),
    );
  }
  if (name === "prompts_update") {
    return t(
      await updatePrompt(sql, String(a.prompt_id), {
        content: String(a.content),
        changeNote: a.change_note as string | undefined,
        createdBy: a.created_by as string | undefined,
        model: a.model as string | undefined,
      }),
    );
  }
  if (name === "prompts_rollback") {
    await rollback(sql, String(a.prompt_id), Number(a.version_number));
    return t({ ok: true, rolled_back_to: Number(a.version_number) });
  }
  if (name === "prompts_list") {
    return t(
      await listPrompts(sql, String(a.workspace_id), {
        tags: a.tags as string[] | undefined,
        search: a.search as string | undefined,
        limit: a.limit as number | undefined,
      }),
    );
  }
  if (name === "prompts_list_versions") {
    return t(await listVersions(sql, String(a.prompt_id)));
  }
  if (name === "prompts_set_override") {
    return t(
      await setOverride(
        sql,
        String(a.prompt_id),
        a.scope_type as "workspace" | "user" | "agent",
        String(a.scope_id),
        String(a.content),
      ),
    );
  }
  if (name === "prompts_create_experiment") {
    return t(
      await createExperiment(sql, {
        promptId: String(a.prompt_id),
        name: String(a.name),
        variants: a.variants as {
          name: string;
          version_id: string;
          weight: number;
        }[],
        trafficPct: a.traffic_pct as number | undefined,
      }),
    );
  }
  if (name === "prompts_diff_versions") {
    const v1 = await getVersion(sql, String(a.prompt_id), Number(a.v1));
    const v2 = await getVersion(sql, String(a.prompt_id), Number(a.v2));
    if (!v1 || !v2) throw new Error("Version not found");
    return t(diffVersions(String(a.prompt_id), v1.content, v2.content));
  }
  if (name === "prompts_delete") {
    return t({ deleted: await deletePrompt(sql, String(a.id)) });
  }
  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const sql = getDb();
  await migrate(sql);
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);
