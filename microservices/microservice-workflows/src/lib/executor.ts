export interface NodeExecutorContext {
  nodeId: string;
  nodeType: string;
  config: Record<string, any>;
  input: Record<string, any>;
}

export type NodeExecutor = (ctx: NodeExecutorContext) => Promise<Record<string, any>>;

export async function executeNode(ctx: NodeExecutorContext): Promise<Record<string, any>> {
  switch (ctx.nodeType) {
    case "task":
      return ctx.config?.handler ? ctx.config.handler(ctx.input) : { done: true, nodeId: ctx.nodeId };
    case "branch":
      // Branch evaluates condition and returns routing decision
      return { branch: ctx.config?.condition ?? "default", nodeId: ctx.nodeId };
    case "parallel":
      // Parallel means fan-out — caller handles multiple branches
      return { parallel: true, nodeId: ctx.nodeId };
    case "wait":
      // Wait node pauses — execution must be resumed externally
      return { waiting: true, nodeId: ctx.nodeId };
    case "end":
      return { finished: true, nodeId: ctx.nodeId };
    default:
      return { done: true, nodeId: ctx.nodeId };
  }
}

export async function retryNode(
  attempt: number,
  maxAttempts: number,
  backoffMs: number,
  fn: () => Promise<void>,
): Promise<void> {
  while (attempt < maxAttempts) {
    try {
      await fn();
      return;
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }
}

export async function skipNode(): Promise<void> {
  // No-op for nodes that should be skipped
}
