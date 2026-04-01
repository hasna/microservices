/**
 * Job worker — polls queue and executes handlers.
 */
import type { Sql } from "postgres";
import { completeJob, dequeue, failJob } from "./queue.js";

export type JobHandler = (payload: any) => Promise<unknown>;

export interface WorkerOptions {
  queue?: string;
  concurrency?: number;
  pollIntervalMs?: number;
  workerId?: string;
}

export class Worker {
  private handlers: Map<string, JobHandler> = new Map();
  private running = false;
  private active = 0;

  constructor(
    private sql: Sql,
    private opts: WorkerOptions = {},
  ) {}

  register(type: string, handler: JobHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  async start(): Promise<void> {
    this.running = true;
    const concurrency = this.opts.concurrency ?? 5;
    const pollMs = this.opts.pollIntervalMs ?? 1000;
    const workerId = this.opts.workerId ?? crypto.randomUUID();
    const queue = this.opts.queue ?? "default";

    console.log(
      `Worker ${workerId} started — queue: ${queue}, concurrency: ${concurrency}`,
    );

    while (this.running) {
      if (this.active < concurrency) {
        const job = await dequeue(this.sql, queue, workerId);
        if (job) {
          this.active++;
          this.processJob(job, workerId).finally(() => this.active--);
        } else {
          await sleep(pollMs);
        }
      } else {
        await sleep(100);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private async processJob(
    job: { id: string; type: string; payload: any },
    _workerId: string,
  ): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await failJob(
        this.sql,
        job.id,
        `No handler registered for type '${job.type}'`,
      );
      return;
    }
    try {
      const result = await handler(job.payload);
      await completeJob(this.sql, job.id, result);
    } catch (err) {
      await failJob(
        this.sql,
        job.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
