/**
 * Circuit breaker for LLM provider fallback chains.
 *
 * Opens the circuit after N consecutive failures for a given provider,
 * then closes it after a cool-down period. Prevents hammering a failing
 * provider and allows graceful degradation.
 */

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Cooldown in ms before attempting to close the circuit */
  cooldownMs: number;
  /** Success count needed to close circuit from half-open */
  successThreshold?: number;
}

export interface CircuitBreakerStats {
  provider: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  openedAt: Date | null;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  successThreshold: 2,
};

/** In-memory circuit breaker registry (per provider) */
const circuits = new Map<string, {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  openedAt: Date | null;
  config: CircuitBreakerConfig;
}>();

/**
 * Initialize or get a circuit breaker for a provider.
 */
export function getCircuitBreaker(
  provider: string,
  config: Partial<CircuitBreakerConfig> = {},
): {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  openedAt: Date | null;
} {
  if (!circuits.has(provider)) {
    circuits.set(provider, {
      state: "closed",
      failures: 0,
      successes: 0,
      lastFailure: null,
      lastSuccess: null,
      openedAt: null,
      config: { ...DEFAULT_CONFIG, ...config },
    });
  }
  return circuits.get(provider)!;
}

function isOpen(cb: ReturnType<typeof getCircuitBreaker>): boolean {
  if (cb.state === "open") {
    const cooldownMs = cb.config.cooldownMs;
    if (cb.openedAt && Date.now() - cb.openedAt.getTime() > cooldownMs) {
      // Transition to half-open
      cb.state = "half_open";
      cb.failures = 0;
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Record a successful call — close the circuit if enough successes in half-open.
 */
export function recordSuccess(provider: string): void {
  const cb = getCircuitBreaker(provider);
  cb.successes++;
  cb.lastSuccess = new Date();

  if (cb.state === "half_open") {
    if (cb.successes >= (cb.config.successThreshold ?? 2)) {
      cb.state = "closed";
      cb.failures = 0;
      cb.successes = 0;
    }
  }
}

/**
 * Record a failed call — open the circuit if threshold exceeded.
 */
export function recordFailure(provider: string): void {
  const cb = getCircuitBreaker(provider);
  cb.failures++;
  cb.lastFailure = new Date();

  if (cb.state === "closed" && cb.failures >= cb.config.failureThreshold) {
    cb.state = "open";
    cb.openedAt = new Date();
  } else if (cb.state === "half_open") {
    // Any failure in half-open immediately opens again
    cb.state = "open";
    cb.openedAt = new Date();
    cb.successes = 0;
  }
}

/**
 * Check if a provider is currently available (circuit not open).
 */
export function isProviderAvailable(provider: string): boolean {
  const cb = getCircuitBreaker(provider);
  return !isOpen(cb);
}

/**
 * Get circuit breaker stats for all tracked providers.
 */
export function getCircuitBreakerStats(
  providers: string[],
): Map<string, CircuitBreakerStats> {
  const stats = new Map<string, CircuitBreakerStats>();
  for (const provider of providers) {
    const cb = getCircuitBreaker(provider);
    stats.set(provider, {
      provider,
      state: cb.state,
      failures: cb.failures,
      successes: cb.successes,
      lastFailure: cb.lastFailure,
      lastSuccess: cb.lastSuccess,
      openedAt: cb.openedAt,
    });
  }
  return stats;
}

/**
 * Reset a circuit breaker (for manual recovery).
 */
export function resetCircuitBreaker(provider: string): void {
  circuits.delete(provider);
}
