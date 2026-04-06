/**
 * Request coalescing — microservice-llm.
 *
 * Batches concurrent requests to the same model within a short time window,
 * reducing total provider calls and improving throughput. Requests that share
 * the same semantic cache key within the coalescing window are served from
 * a single upstream call.
 *
 * Usage:
 *   const co = createRequestCoalescer({ maxBatchSize: 10, windowMs: 50 })
 *   co.enqueue(request, cacheKey).then(result => ...)
 */

export interface CoalescedRequest<TReq, TResp> {
  request: TReq;
  cacheKey: string;
  resolve: (value: TResp) => void;
  reject: (err: Error) => void;
}

interface Batch<TReq, TResp> {
  items: CoalescedRequest<TReq, TResp>[];
  timer: ReturnType<typeof setTimeout> | null;
  promise: Promise<TResp[]> | null;
}

export interface CoalescerOptions {
  maxBatchSize?: number;    // Max requests per batch (default 10)
  windowMs?: number;         // Time to wait for more requests (default 50ms)
  maxWaitMs?: number;         // Max time to hold a request waiting for batch (default 200ms)
}

export class RequestCoalescer<TReq, TResp> {
  private batches: Map<string, Batch<TReq, TResp>> = new Map();
  private opts: Required<CoalescerOptions>;

  constructor(opts: CoalescerOptions = {}) {
    this.opts = {
      maxBatchSize: opts.maxBatchSize ?? 10,
      windowMs: opts.windowMs ?? 50,
      maxWaitMs: opts.maxWaitMs ?? 200,
    };
  }

  /**
   * Enqueue a request to be batched with others of the same cache key.
   * Returns a promise that resolves when the request completes.
   */
  enqueue(request: TReq, cacheKey: string, execute: (batch: TReq[]) => Promise<TResp[]>): Promise<TResp> {
    return new Promise<TResp>((resolve, reject) => {
      const existing = this.batches.get(cacheKey);

      if (existing && existing.items.length < this.opts.maxBatchSize) {
        // Add to existing batch
        existing.items.push({ request, cacheKey, resolve, reject });
        // If batch is now full, execute immediately
        if (existing.items.length >= this.opts.maxBatchSize) {
          this.executeBatch(cacheKey, execute);
        }
      } else {
        // Start a new batch
        const batch: Batch<TReq, TResp> = {
          items: [{ request, cacheKey, resolve, reject }],
          timer: null,
          promise: null,
        };
        this.batches.set(cacheKey, batch);

        // Set window timer
        batch.timer = setTimeout(() => {
          this.executeBatch(cacheKey, execute);
        }, this.opts.windowMs);
      }
    });
  }

  private async executeBatch(cacheKey: string, execute: (batch: TReq[]) => Promise<TResp[]>): Promise<void> {
    const batch = this.batches.get(cacheKey);
    if (!batch) return;

    // Clear timer and batch state
    if (batch.timer) clearTimeout(batch.timer);
    this.batches.delete(cacheKey);

    const items = batch.items;
    if (items.length === 0) return;

    try {
      const results = await execute(items.map((i) => i.request));
      // Resolve each promise with its corresponding result
      for (let i = 0; i < items.length; i++) {
        items[i].resolve(results[i] ?? results[results.length - 1]);
      }
    } catch (err) {
      for (const item of items) {
        item.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /**
   * Get current batch stats for monitoring.
   */
  getStats() {
    let totalItems = 0;
    for (const batch of this.batches.values()) {
      totalItems += batch.items.length;
    }
    return {
      activeBatches: this.batches.size,
      totalQueuedItems: totalItems,
    };
  }
}

/**
 * Create a global request coalescer for LLM calls.
 */
let globalCoalescer: RequestCoalescer<unknown, unknown> | null = null;

export function getGlobalCoalescer<TReq, TResp>(): RequestCoalescer<TReq, TResp> {
  if (!globalCoalescer) {
    globalCoalescer = new RequestCoalescer<TReq, TResp>({
      maxBatchSize: 10,
      windowMs: 50,
      maxWaitMs: 200,
    });
  }
  return globalCoalescer as RequestCoalescer<TReq, TResp>;
}