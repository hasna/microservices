import type { Sql } from "postgres";

export interface Version {
  id: string;
  prompt_id: string;
  version_number: number;
  content: string;
  variables: string[];
  model: string | null;
  created_by: string | null;
  change_note: string | null;
  created_at: string;
}

export interface DiffResult {
  added: string[];
  removed: string[];
  unchanged: string[];
}

/** Extract declared {{variables}} from content */
function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

export async function updatePrompt(
  sql: Sql,
  promptId: string,
  opts: {
    content: string;
    changeNote?: string;
    createdBy?: string;
    model?: string;
  },
): Promise<Version> {
  const variables = extractVariables(opts.content);
  return await sql.begin(async (tx: any) => {
    const [maxRow] = await (tx as any)`
      SELECT COALESCE(MAX(version_number), 0) AS max_v FROM prompts.versions WHERE prompt_id = ${promptId}`;
    const nextVersion = (maxRow.max_v as number) + 1;

    const [version] = await (tx as any)`
      INSERT INTO prompts.versions (prompt_id, version_number, content, variables, model, created_by, change_note)
      VALUES (${promptId}, ${nextVersion}, ${opts.content}, ${variables}, ${opts.model ?? null}, ${opts.createdBy ?? null}, ${opts.changeNote ?? null})
      RETURNING *`;

    await (tx as any)`UPDATE prompts.prompts SET current_version_id = ${version.id}, updated_at = NOW() WHERE id = ${promptId}`;
    return version as unknown as Version;
  });
}

export async function getVersion(
  sql: Sql,
  promptId: string,
  versionNumber?: number,
): Promise<Version | null> {
  if (versionNumber !== undefined) {
    const [row] = await sql`
      SELECT * FROM prompts.versions WHERE prompt_id = ${promptId} AND version_number = ${versionNumber}`;
    return row ? (row as unknown as Version) : null;
  }
  // Get latest
  const [row] = await sql`
    SELECT * FROM prompts.versions WHERE prompt_id = ${promptId} ORDER BY version_number DESC LIMIT 1`;
  return row ? (row as unknown as Version) : null;
}

export async function listVersions(
  sql: Sql,
  promptId: string,
): Promise<Version[]> {
  return (await sql`
    SELECT * FROM prompts.versions WHERE prompt_id = ${promptId} ORDER BY version_number DESC`) as unknown as Version[];
}

export async function rollback(
  sql: Sql,
  promptId: string,
  toVersionNumber: number,
): Promise<void> {
  const [version] = await sql`
    SELECT id FROM prompts.versions WHERE prompt_id = ${promptId} AND version_number = ${toVersionNumber}`;
  if (!version)
    throw new Error(
      `Version ${toVersionNumber} not found for prompt ${promptId}`,
    );
  await sql`UPDATE prompts.prompts SET current_version_id = ${version.id}, updated_at = NOW() WHERE id = ${promptId}`;
}

export function diffVersions(
  _promptId: string,
  v1Content: string,
  v2Content: string,
): DiffResult {
  const lines1 = v1Content.split("\n");
  const lines2 = v2Content.split("\n");
  const set1 = new Set(lines1);
  const set2 = new Set(lines2);

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const line of lines2) {
    if (set1.has(line)) {
      unchanged.push(line);
    } else {
      added.push(line);
    }
  }
  for (const line of lines1) {
    if (!set2.has(line)) {
      removed.push(line);
    }
  }
  return { added, removed, unchanged };
}
