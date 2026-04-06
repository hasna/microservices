#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createExperiment, pickVariant, startExperiment, stopExperiment, getAssignment, listExperiments } from "../lib/experiments.js";
import { setOverride, getOverrideForScope, removeOverride, listOverrides } from "../lib/overrides.js";
import {
  createPrompt,
  deletePrompt,
  getPrompt,
  getPromptById,
  listPrompts,
  clonePrompt,
  validateVariables,
} from "../lib/prompts_crud.js";
import { resolvePrompt, interpolateVariables } from "../lib/resolve.js";
import {
  diffVersions,
  getVersion,
  listVersions,
  rollback,
  updatePrompt,
} from "../lib/versions.js";
import { searchPrompts } from "../lib/search.js";

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
    {
      name: "prompts_get_override",
      description: "Get the active override for a prompt at a given scope",
      inputSchema: {
        type: "object",
        properties: {
          prompt_id: { type: "string" },
          scope_type: { type: "string" },
          scope_id: { type: "string" },
        },
        required: ["prompt_id", "scope_type", "scope_id"],
      },
    },
    {
      name: "prompts_remove_override",
      description: "Remove a prompt override for a scope",
      inputSchema: {
        type: "object",
        properties: { override_id: { type: "string" } },
        required: ["override_id"],
      },
    },
    {
      name: "prompts_pick_variant",
      description: "Pick an experiment variant for a user (uses sticky assignment)",
      inputSchema: {
        type: "object",
        properties: {
          experiment_id: { type: "string" },
          user_id: { type: "string" },
        },
        required: ["experiment_id", "user_id"],
      },
    },
    {
      name: "prompts_list_overrides",
      description: "List all overrides for a prompt",
      inputSchema: { type: "object", properties: { prompt_id: { type: "string" } }, required: ["prompt_id"] },
    },
    {
      name: "prompts_interpolate",
      description: "Interpolate variables into a prompt template without resolution (direct substitution)",
      inputSchema: {
        type: "object",
        properties: {
          template: { type: "string" },
          variables: { type: "object" },
        },
        required: ["template", "variables"],
      },
    },
    {
      name: "prompts_get_prompt",
      description: "Get the latest version of a prompt by workspace and name",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          name: { type: "string" },
        },
        required: ["workspace_id", "name"],
      },
    },
    {
      name: "prompts_start_experiment",
      description: "Start an A/B experiment (enable variant assignment)",
      inputSchema: { type: "object", properties: { experiment_id: { type: "string" } }, required: ["experiment_id"] },
    },
    {
      name: "prompts_stop_experiment",
      description: "Stop an A/B experiment (disable new assignments, keep existing)",
      inputSchema: { type: "object", properties: { experiment_id: { type: "string" } }, required: ["experiment_id"] },
    },
    {
      name: "prompts_list_experiments",
      description: "List all experiments for a prompt",
      inputSchema: { type: "object", properties: { prompt_id: { type: "string" } }, required: ["prompt_id"] },
    },
    {
      name: "prompts_get_assignment",
      description: "Get which variant a user was assigned to in an experiment",
      inputSchema: {
        type: "object",
        properties: { experiment_id: { type: "string" }, user_id: { type: "string" } },
        required: ["experiment_id", "user_id"],
      },
    },
    {
      name: "prompts_get_prompt_by_id",
      description: "Get a prompt by its UUID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "prompts_search",
      description: "Full-text search across prompt names, descriptions, and content",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id", "query"],
      },
    },
    {
      name: "prompts_clone",
      description: "Clone an existing prompt with a new name (copies current version)",
      inputSchema: {
        type: "object",
        properties: {
          source_prompt_id: { type: "string" },
          new_name: { type: "string" },
          created_by: { type: "string" },
        },
        required: ["source_prompt_id", "new_name"],
      },
    },
    {
      name: "prompts_validate_variables",
      description: "Validate that provided variables match the expected template variables",
      inputSchema: {
        type: "object",
        properties: {
          template: { type: "string" },
          variables: { type: "object" },
        },
        required: ["template", "variables"],
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
  if (name === "prompts_get_override") {
    const override = await getOverrideForScope(
      sql,
      String(a.prompt_id),
      a.scope_type as "workspace" | "user" | "agent",
      String(a.scope_id),
    );
    return t(override || null);
  }
  if (name === "prompts_remove_override") {
    return t({ removed: await removeOverride(sql, String(a.override_id)) });
  }
  if (name === "prompts_pick_variant") {
    return t(await pickVariant(sql, String(a.experiment_id), String(a.user_id)));
  }
  if (name === "prompts_list_overrides") {
    return t(await listOverrides(sql, String(a.prompt_id)));
  }
  if (name === "prompts_interpolate") {
    return t({ result: interpolateVariables(String(a.template), a.variables as Record<string, string>) });
  }
  if (name === "prompts_get_prompt") {
    return t(await getPrompt(sql, String(a.workspace_id), String(a.name)));
  }
  if (name === "prompts_start_experiment") {
    return t(await startExperiment(sql, String(a.experiment_id)));
  }
  if (name === "prompts_stop_experiment") {
    return t(await stopExperiment(sql, String(a.experiment_id)));
  }
  if (name === "prompts_list_experiments") {
    return t(await listExperiments(sql, String(a.prompt_id)));
  }
  if (name === "prompts_get_assignment") {
    return t(await getAssignment(sql, String(a.experiment_id), String(a.user_id)));
  }
  if (name === "prompts_get_prompt_by_id") {
    return t(await getPromptById(sql, String(a.id)));
  }
  if (name === "prompts_search") {
    return t(await searchPrompts(sql, String(a.workspace_id), String(a.query), { limit: a.limit as number | undefined }));
  }
  if (name === "prompts_clone") {
    return t(await clonePrompt(sql, String(a.source_prompt_id), String(a.new_name), a.created_by as string | undefined));
  }
  if (name === "prompts_validate_variables") {
    return t(validateVariables(String(a.template), a.variables as Record<string, string>));
  }
  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const sql = getDb();
  await migrate(sql);
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);
