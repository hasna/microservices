import type { Sql } from "postgres";
import { getAssignment } from "./experiments.js";
import { getOverrideForScope } from "./overrides.js";
import { getPrompt } from "./prompts_crud.js";

export interface ResolveResult {
  content: string;
  source: "experiment" | "override" | "current";
  version_number: number | null;
  experiment_variant?: string;
}

export interface ResolveContext {
  userId?: string;
  agentId?: string;
  variables?: Record<string, string>;
}

/** Replace {{key}} with value, leave unmatched as-is */
export function interpolateVariables(
  content: string,
  variables: Record<string, string>,
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in variables ? variables[key] : match;
  });
}

export async function resolvePrompt(
  sql: Sql,
  workspaceId: string,
  name: string,
  context: ResolveContext = {},
): Promise<ResolveResult> {
  const prompt = await getPrompt(sql, workspaceId, name);
  if (!prompt)
    throw new Error(`Prompt '${name}' not found in workspace ${workspaceId}`);

  const vars = context.variables ?? {};

  // 1. Check experiments (running ones)
  const [experiment] = await sql`
    SELECT * FROM prompts.experiments
    WHERE prompt_id = ${prompt.id} AND status = 'running'
    ORDER BY created_at DESC LIMIT 1`;

  if (experiment && context.userId) {
    const variants = experiment.variants as {
      name: string;
      version_id: string;
      weight: number;
    }[];
    if (variants.length > 0) {
      const variantName = await getAssignment(
        sql,
        experiment.id,
        context.userId,
      );
      const variant = variants.find((v) => v.name === variantName);
      if (variant) {
        const [ver] =
          await sql`SELECT * FROM prompts.versions WHERE id = ${variant.version_id}`;
        if (ver) {
          return {
            content: interpolateVariables(ver.content as string, vars),
            source: "experiment",
            version_number: ver.version_number as number,
            experiment_variant: variantName,
          };
        }
      }
    }
  }

  // 2. Check overrides — user > agent > workspace priority
  if (context.userId) {
    const ov = await getOverrideForScope(
      sql,
      prompt.id,
      "user",
      context.userId,
    );
    if (ov)
      return {
        content: interpolateVariables(ov.content, vars),
        source: "override",
        version_number: null,
      };
  }
  if (context.agentId) {
    const ov = await getOverrideForScope(
      sql,
      prompt.id,
      "agent",
      context.agentId,
    );
    if (ov)
      return {
        content: interpolateVariables(ov.content, vars),
        source: "override",
        version_number: null,
      };
  }
  {
    const ov = await getOverrideForScope(
      sql,
      prompt.id,
      "workspace",
      workspaceId,
    );
    if (ov)
      return {
        content: interpolateVariables(ov.content, vars),
        source: "override",
        version_number: null,
      };
  }

  // 3. Fall back to current version
  return {
    content: interpolateVariables(prompt.content ?? "", vars),
    source: "current",
    version_number: prompt.version_number,
  };
}
