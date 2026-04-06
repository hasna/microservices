/**
 * Model registry — tracks available models, providers, capabilities, and aliases.
 * Enables dynamic model selection, fallback chains, and cost tracking per model.
 */

import type { Sql } from "postgres";

export type ModelCapability = "chat" | "completion" | "embedding" | "image" | "audio" | "function_calling" | "streaming";
export type ProviderType = "openai" | "anthropic" | "google" | "mistral" | "ollama" | "custom";

export interface ModelInfo {
  id: string;
  provider: ProviderType;
  name: string;
  display_name: string;
  description: string | null;
  context_window: number;
  max_output_tokens: number | null;
  cost_per_1k_input: number;  // USD
  cost_per_1k_output: number; // USD
  capabilities: ModelCapability[];
  default_kwargs: Record<string, unknown>;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ProviderInfo {
  id: string;
  type: ProviderType;
  name: string;
  base_url: string | null;
  api_key_secret: string; // name of env var, not the actual key
  is_active: boolean;
  default_model_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface ModelAlias {
  alias: string;
  model_id: string;
  workspace_id: string | null; // null = global
  created_at: Date;
}

export interface CreateModelInput {
  provider: ProviderType;
  name: string;
  display_name?: string;
  description?: string;
  context_window?: number;
  max_output_tokens?: number;
  cost_per_1k_input?: number;
  cost_per_1k_output?: number;
  capabilities?: ModelCapability[];
  default_kwargs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CreateProviderInput {
  type: ProviderType;
  name: string;
  base_url?: string;
  api_key_secret: string;
  default_model_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Register a new model in the registry.
 */
export async function registerModel(
  sql: Sql,
  input: CreateModelInput,
): Promise<ModelInfo> {
  const [model] = await sql<ModelInfo[]>`
    INSERT INTO llm.models
      (provider, name, display_name, description, context_window,
       max_output_tokens, cost_per_1k_input, cost_per_1k_output,
       capabilities, default_kwargs, is_active, metadata)
    VALUES (
      ${input.provider},
      ${input.name},
      ${input.display_name ?? input.name},
      ${input.description ?? null},
      ${input.context_window ?? 4096},
      ${input.max_output_tokens ?? null},
      ${input.cost_per_1k_input ?? 0},
      ${input.cost_per_1k_output ?? 0},
      ${input.capabilities ?? ["chat"]},
      ${input.default_kwargs ?? {}},
      true,
      ${input.metadata ?? {}}
    )
    RETURNING *
  `;
  return model;
}

/**
 * Get a model by ID or alias.
 */
export async function getModel(
  sql: Sql,
  identifier: string,
  workspaceId?: string,
): Promise<ModelInfo | null> {
  // Try ID first
  const [byId] = await sql<ModelInfo[]>`
    SELECT m.* FROM llm.models m WHERE m.id = ${identifier}
  `;
  if (byId) return byId;

  // Try alias lookup
  if (workspaceId) {
    const [byAlias] = await sql<ModelInfo[]>`
      SELECT m.* FROM llm.models m
      JOIN llm.model_aliases a ON a.model_id = m.id
      WHERE a.alias = ${identifier}
        AND (a.workspace_id = ${workspaceId} OR a.workspace_id IS NULL)
      LIMIT 1
    `;
    if (byAlias) return byAlias;
  }

  return null;
}

/**
 * List all active models, optionally filtered by provider/capability.
 */
export async function listModels(
  sql: Sql,
  filters?: {
    provider?: ProviderType;
    capability?: ModelCapability;
    is_active?: boolean;
  },
): Promise<ModelInfo[]> {
  let query = sql<ModelInfo[]>`SELECT * FROM llm.models WHERE 1=1`;
  if (filters?.provider) query = sql<ModelInfo[]>`SELECT * FROM llm.models WHERE provider = ${filters.provider}`;
  if (filters?.is_active !== undefined) query = sql<ModelInfo[]>`SELECT * FROM llm.models WHERE is_active = ${filters.is_active}`;

  const [rows] = await sql<ModelInfo[]>`
    SELECT * FROM llm.models
    WHERE is_active = ${filters?.is_active ?? true}
      AND ${filters?.provider ? sql`provider = ${filters.provider}` : sql`true`}
    ORDER BY display_name
  `;
  return rows;
}

/**
 * List all providers.
 */
export async function listProviders(sql: Sql): Promise<ProviderInfo[]> {
  const [rows] = await sql<ProviderInfo[]>`SELECT * FROM llm.providers WHERE is_active = true ORDER BY name`;
  return rows;
}

/**
 * Register a new provider.
 */
export async function registerProvider(
  sql: Sql,
  input: CreateProviderInput,
): Promise<ProviderInfo> {
  const [provider] = await sql<ProviderInfo[]>`
    INSERT INTO llm.providers (type, name, base_url, api_key_secret, is_active, metadata)
    VALUES (${input.type}, ${input.name}, ${input.base_url ?? null}, ${input.api_key_secret}, true, ${input.metadata ?? {}})
    RETURNING *
  `;
  return provider;
}

/**
 * Create a model alias for a workspace or globally.
 */
export async function createModelAlias(
  sql: Sql,
  alias: string,
  modelId: string,
  workspaceId?: string,
): Promise<ModelAlias> {
  const [row] = await sql<ModelAlias[]>`
    INSERT INTO llm.model_aliases (alias, model_id, workspace_id)
    VALUES (${alias}, ${modelId}, ${workspaceId ?? null})
    ON CONFLICT DO NOTHING
    RETURNING *
  `;
  return row;
}

/**
 * Get available models for a workspace (considering aliases and active status).
 */
export async function getWorkspaceModels(
  sql: Sql,
  workspaceId: string,
  capability?: ModelCapability,
): Promise<ModelInfo[]> {
  const [rows] = await sql<ModelInfo[]>`
    SELECT DISTINCT m.* FROM llm.models m
    LEFT JOIN llm.model_aliases a ON a.model_id = m.id
    WHERE m.is_active = true
      AND (a.workspace_id = ${workspaceId} OR a.workspace_id IS NULL)
      AND ${capability ? sql`${sql`${capability} = ANY(m.capabilities)`}` : sql`true`}
    ORDER BY m.display_name
  `;
  return rows;
}

/**
 * Get fallback chain for a model.
 */
export async function getModelFallbackChain(
  sql: Sql,
  modelId: string,
): Promise<ModelInfo[]> {
  const [row] = await sql<{ fallback_chain: string[] }[]>`
    SELECT metadata->'fallback_chain' as fallback_chain FROM llm.models WHERE id = ${modelId}
  `;
  if (!row?.fallback_chain) return [];

  const [models] = await sql<ModelInfo[]>`
    SELECT * FROM llm.models WHERE id IN ${sql(row.fallback_chain)} AND is_active = true
  `;
  return models;
}

/**
 * Update a model.
 */
export async function updateModel(
  sql: Sql,
  modelId: string,
  updates: Partial<ModelInfo>,
): Promise<ModelInfo | null> {
  const [existing] = await sql<ModelInfo[]>`SELECT * FROM llm.models WHERE id = ${modelId}`;
  if (!existing) return null;

  const [updated] = await sql<ModelInfo[]>`
    UPDATE llm.models SET
      display_name = ${updates.display_name ?? existing.display_name},
      description = ${updates.description ?? existing.description},
      context_window = ${updates.context_window ?? existing.context_window},
      max_output_tokens = ${updates.max_output_tokens ?? existing.max_output_tokens},
      cost_per_1k_input = ${updates.cost_per_1k_input ?? existing.cost_per_1k_input},
      cost_per_1k_output = ${updates.cost_per_1k_output ?? existing.cost_per_1k_output},
      is_active = ${updates.is_active ?? existing.is_active},
      metadata = ${updates.metadata ?? existing.metadata},
      updated_at = NOW()
    WHERE id = ${modelId}
    RETURNING *
  `;
  return updated;
}

/**
 * Deactivate a model.
 */
export async function deactivateModel(sql: Sql, modelId: string): Promise<boolean> {
  const result = await sql`UPDATE llm.models SET is_active = false WHERE id = ${modelId}`;
  return (result as any).count > 0;
}