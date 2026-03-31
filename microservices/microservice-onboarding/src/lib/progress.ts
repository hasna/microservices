import type { Sql } from "postgres";
import type { Flow, FlowStep } from "./flows.js";
import { getFlow } from "./flows.js";

export interface Progress {
  id: string;
  workspace_id: string | null;
  user_id: string;
  flow_id: string;
  completed_steps: string[];
  started_at: Date;
  completed_at: Date | null;
}

export interface ProgressSummary {
  progress: Progress | null;
  flow: Flow | null;
  completed_steps: string[];
  pending_steps: { id: string; title: string; required: boolean }[];
  percentage: number;
  is_complete: boolean;
}

export async function startFlow(
  sql: Sql,
  userId: string,
  flowId: string,
  workspaceId?: string
): Promise<Progress> {
  const [row] = await sql<Progress[]>`
    INSERT INTO onboarding.progress (user_id, flow_id, workspace_id)
    VALUES (${userId}, ${flowId}, ${workspaceId ?? null})
    ON CONFLICT (user_id, flow_id) DO UPDATE
      SET workspace_id = COALESCE(EXCLUDED.workspace_id, onboarding.progress.workspace_id)
    RETURNING *
  `;
  return row;
}

export async function markStep(
  sql: Sql,
  userId: string,
  flowId: string,
  stepId: string
): Promise<Progress> {
  // Add stepId only if not already present (idempotent)
  const [row] = await sql<Progress[]>`
    UPDATE onboarding.progress
    SET completed_steps = CASE
      WHEN ${stepId} = ANY(completed_steps) THEN completed_steps
      ELSE array_append(completed_steps, ${stepId})
    END
    WHERE user_id = ${userId} AND flow_id = ${flowId}
    RETURNING *
  `;

  if (!row) throw new Error(`No progress record found for user ${userId} and flow ${flowId}`);

  // Check if all required steps are now complete
  const flow = await getFlow(sql, flowId);
  if (flow) {
    const requiredSteps = (flow.steps as FlowStep[]).filter(s => s.required !== false);
    const allDone = requiredSteps.every(s => row.completed_steps.includes(s.id));
    if (allDone && !row.completed_at) {
      const [updated] = await sql<Progress[]>`
        UPDATE onboarding.progress
        SET completed_at = NOW()
        WHERE user_id = ${userId} AND flow_id = ${flowId}
        RETURNING *
      `;
      return updated;
    }
  }

  return row;
}

export async function getProgress(
  sql: Sql,
  userId: string,
  flowId: string
): Promise<ProgressSummary | null> {
  const [progress] = await sql<Progress[]>`
    SELECT * FROM onboarding.progress WHERE user_id = ${userId} AND flow_id = ${flowId}
  `;
  const flow = await getFlow(sql, flowId);

  if (!flow) return null;

  const steps = flow.steps as FlowStep[];
  const completedSteps = progress?.completed_steps ?? [];

  const pendingSteps = steps
    .filter(s => !completedSteps.includes(s.id))
    .map(s => ({ id: s.id, title: s.title, required: s.required !== false }));

  const requiredSteps = steps.filter(s => s.required !== false);
  const completedRequired = requiredSteps.filter(s => completedSteps.includes(s.id));

  const percentage = requiredSteps.length === 0
    ? 100
    : Math.round((completedRequired.length / requiredSteps.length) * 100);

  const isComplete = requiredSteps.length === 0 || requiredSteps.every(s => completedSteps.includes(s.id));

  return {
    progress: progress ?? null,
    flow,
    completed_steps: completedSteps,
    pending_steps: pendingSteps,
    percentage,
    is_complete: isComplete,
  };
}

export async function isComplete(
  sql: Sql,
  userId: string,
  flowId: string
): Promise<boolean> {
  const summary = await getProgress(sql, userId, flowId);
  if (!summary) return false;
  return summary.is_complete;
}

export async function resetProgress(
  sql: Sql,
  userId: string,
  flowId: string
): Promise<void> {
  await sql`
    UPDATE onboarding.progress
    SET completed_steps = '{}', completed_at = NULL
    WHERE user_id = ${userId} AND flow_id = ${flowId}
  `;
}

export async function getUserFlows(
  sql: Sql,
  userId: string
): Promise<{ flow: Flow; progress: Progress }[]> {
  const progressRows = await sql<Progress[]>`
    SELECT * FROM onboarding.progress WHERE user_id = ${userId} ORDER BY started_at ASC
  `;

  const results: { flow: Flow; progress: Progress }[] = [];
  for (const progress of progressRows) {
    const flow = await getFlow(sql, progress.flow_id);
    if (flow) results.push({ flow, progress });
  }

  return results;
}
