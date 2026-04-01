/**
 * Cost calculation per provider/model.
 * Prices are per 1K tokens (approximate).
 */

export const COST_PER_1K_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
  "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
  "claude-3-5-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-haiku-20240307": { input: 0.00025, output: 0.00125 },
  "claude-3-haiku": { input: 0.00025, output: 0.00125 },
  "llama-3.1-70b-versatile": { input: 0.00059, output: 0.00079 },
  "mixtral-8x7b-32768": { input: 0.00027, output: 0.00027 },
  "gemma-7b-it": { input: 0.0001, output: 0.0001 },
  default: { input: 0.001, output: 0.002 },
};

/**
 * Calculate cost in USD for a given model and token counts.
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  if (promptTokens === 0 && completionTokens === 0) return 0;

  // Try exact match first, then prefix match, then default
  const rates =
    COST_PER_1K_TOKENS[model] ??
    Object.entries(COST_PER_1K_TOKENS).find(
      ([key]) => key !== "default" && model.startsWith(key),
    )?.[1] ??
    COST_PER_1K_TOKENS.default!;

  const inputCost = (promptTokens / 1000) * rates.input;
  const outputCost = (completionTokens / 1000) * rates.output;

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
