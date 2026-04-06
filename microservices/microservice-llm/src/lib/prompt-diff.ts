/**
 * Prompt version diff — compare two versions of a prompt template
 * to understand what changed between iterations.
 */

import type { Sql } from "postgres";

export interface PromptDiffResult {
  template_id: string;
  version_a: number;
  version_b: number;
  changes: PromptChange[];
  summary: string;
  similarity_score: number; // 0-1, higher = more similar
}

export interface PromptChange {
  type: "added" | "removed" | "modified";
  location: "system" | "user" | "assistant" | "variables";
  old_value?: string;
  new_value?: string;
  line_start?: number;
  line_end?: number;
}

/**
 * Compute a detailed diff between two versions of a prompt template.
 */
export async function computePromptDiff(
  sql: Sql,
  templateId: string,
  versionA: number,
  versionB: number,
): Promise<PromptDiffResult> {
  const [versionRowA] = await sql<{ content: string; variables: string[] }[]>`
    SELECT content, variables FROM llm.prompt_versions
    WHERE template_id = ${templateId} AND version_number = ${versionA}
  `;

  const [versionRowB] = await sql<{ content: string; variables: string[] }[]>`
    SELECT content, variables FROM llm.prompt_versions
    WHERE template_id = ${templateId} AND version_number = ${versionB}
  `;

  if (!versionRowA || !versionRowB) {
    throw new Error(`Version not found: ${!versionRowA ? versionA : versionB}`);
  }

  const contentA = versionRowA.content;
  const contentB = versionRowB.content;
  const variablesA = versionRowA.variables;
  const variablesB = versionRowB.variables;

  const changes: PromptChange[] = [];

  // Simple line-by-line diff for content
  const linesA = contentA.split("\n");
  const linesB = contentB.split("\n");
  const maxLines = Math.max(linesA.length, linesB.length);

  for (let i = 0; i < maxLines; i++) {
    const lineA = linesA[i];
    const lineB = linesB[i];

    if (lineA === undefined && lineB !== undefined) {
      changes.push({ type: "added", location: inferLocation(lineB, variablesB), new_value: lineB, line_start: i + 1, line_end: i + 1 });
    } else if (lineA !== undefined && lineB === undefined) {
      changes.push({ type: "removed", location: inferLocation(lineA, variablesA), old_value: lineA, line_start: i + 1, line_end: i + 1 });
    } else if (lineA !== lineB) {
      changes.push({ type: "modified", location: inferLocation(lineB ?? lineA, variablesB), old_value: lineA, new_value: lineB, line_start: i + 1, line_end: i + 1 });
    }
  }

  // Variable changes
  const addedVars = variablesB.filter(v => !variablesA.includes(v));
  const removedVars = variablesA.filter(v => !variablesB.includes(v));

  for (const v of addedVars) {
    changes.push({ type: "added", location: "variables", new_value: v });
  }
  for (const v of removedVars) {
    changes.push({ type: "removed", location: "variables", old_value: v });
  }

  // Compute similarity score
  const identicalLines = changes.filter(c => c.type !== "modified").length;
  const totalLines = maxLines + Math.max(variablesA.length, variablesB.length);
  const similarityScore = totalLines > 0 ? Math.max(0, 1 - (changes.length / totalLines)) : 1;

  const summary = generateDiffSummary(changes);

  return {
    template_id: templateId,
    version_a: versionA,
    version_b: versionB,
    changes,
    summary,
    similarity_score: Math.round(similarityScore * 100) / 100,
  };
}

function inferLocation(line: string, variables: string[]): "system" | "user" | "assistant" | "variables" {
  const lower = line.toLowerCase();
  if (lower.includes("<|system|>") || lower.includes("system:")) return "system";
  if (lower.includes("<|user|>") || lower.includes("user:")) return "user";
  if (lower.includes("<|assistant|>") || lower.includes("assistant:")) return "assistant";
  if (variables.some(v => line.includes(`{${v}}`) || line.includes(`{{${v}}}`))) return "variables";
  return "user";
}

function generateDiffSummary(changes: PromptChange[]): string {
  const added = changes.filter(c => c.type === "added").length;
  const removed = changes.filter(c => c.type === "removed").length;
  const modified = changes.filter(c => c.type === "modified").length;

  const parts: string[] = [];
  if (added > 0) parts.push(`${added} line${added > 1 ? "s" : ""} added`);
  if (removed > 0) parts.push(`${removed} line${removed > 1 ? "s" : ""} removed`);
  if (modified > 0) parts.push(`${modified} line${modified > 1 ? "s" : ""} modified`);

  return parts.length > 0 ? parts.join(", ") : "No changes";
}

/**
 * Get a side-by-side view of two prompt versions.
 */
export async function getPromptVersionSideBySide(
  sql: Sql,
  templateId: string,
  versionA: number,
  versionB: number,
): Promise<{ version_a: { version: number; content: string; variables: string[] }; version_b: { version: number; content: string; variables: string[] } }> {
  const [rowA] = await sql<{ version_number: number; content: string; variables: string[] }[]>`
    SELECT version_number, content, variables FROM llm.prompt_versions
    WHERE template_id = ${templateId} AND version_number = ${versionA}
  `;

  const [rowB] = await sql<{ version_number: number; content: string; variables: string[] }[]>`
    SELECT version_number, content, variables FROM llm.prompt_versions
    WHERE template_id = ${templateId} AND version_number = ${versionB}
  `;

  if (!rowA || !rowB) {
    throw new Error(`Version not found: ${!rowA ? versionA : versionB}`);
  }

  return {
    version_a: { version: rowA.version_number, content: rowA.content, variables: rowA.variables },
    version_b: { version: rowB.version_number, content: rowB.content, variables: rowB.variables },
  };
}