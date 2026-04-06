/**
 * Memory relationships — links between memories (references, parent-child, related).
 */

import type { Sql } from "postgres";

export type LinkType = "parent" | "child" | "related" | "references" | "derived_from";

export interface MemoryLink {
  id: string;
  source_id: string;
  target_id: string;
  link_type: LinkType;
  label: string | null;
  created_at: Date;
}

export interface MemoryLinkWithTarget extends MemoryLink {
  target_content: string;
  target_summary: string | null;
  target_memory_type: string;
  target_importance: number;
}

export interface MemoryLinkWithSource extends MemoryLink {
  source_content: string;
  source_summary: string | null;
  source_memory_type: string;
  source_importance: number;
}

/**
 * Create a link between two memories.
 */
export async function linkMemories(
  sql: Sql,
  sourceId: string,
  targetId: string,
  linkType: LinkType,
  label?: string,
): Promise<MemoryLink> {
  const [link] = await sql<MemoryLink[]>`
    INSERT INTO memory.memory_links (source_id, target_id, link_type, label)
    VALUES (${sourceId}, ${targetId}, ${linkType}, ${label ?? null})
    ON CONFLICT (source_id, target_id, link_type) DO UPDATE SET label = EXCLUDED.label
    RETURNING *
  `;
  return link;
}

/**
 * Delete a link between two memories by link type.
 */
export async function unlinkMemories(
  sql: Sql,
  sourceId: string,
  targetId: string,
  linkType?: LinkType,
): Promise<number> {
  if (linkType) {
    const result = await sql.unsafe(
      `DELETE FROM memory.memory_links WHERE source_id = $1 AND target_id = $2 AND link_type = $3`,
      [sourceId, targetId, linkType],
    );
    return result.count ?? 0;
  }
  const result = await sql.unsafe(
    `DELETE FROM memory.memory_links WHERE source_id = $1 AND target_id = $2`,
    [sourceId, targetId],
  );
  return result.count ?? 0;
}

/**
 * Get all links originating from a memory.
 */
export async function getOutgoingLinks(
  sql: Sql,
  memoryId: string,
  linkType?: LinkType,
): Promise<MemoryLinkWithTarget[]> {
  if (linkType) {
    return sql<MemoryLinkWithTarget[]>`
      SELECT ml.*,
             m.content as target_content,
             m.summary as target_summary,
             m.memory_type as target_memory_type,
             m.importance as target_importance
      FROM memory.memory_links ml
      JOIN memory.memories m ON m.id = ml.target_id
      WHERE ml.source_id = ${memoryId}
        AND ml.link_type = ${linkType}
      ORDER BY ml.created_at ASC
    `;
  }
  return sql<MemoryLinkWithTarget[]>`
    SELECT ml.*,
           m.content as target_content,
           m.summary as target_summary,
           m.memory_type as target_memory_type,
           m.importance as target_importance
    FROM memory.memory_links ml
    JOIN memory.memories m ON m.id = ml.target_id
    WHERE ml.source_id = ${memoryId}
    ORDER BY ml.link_type, ml.created_at ASC
  `;
}

/**
 * Get all links pointing to a memory.
 */
export async function getIncomingLinks(
  sql: Sql,
  memoryId: string,
  linkType?: LinkType,
): Promise<MemoryLinkWithSource[]> {
  if (linkType) {
    return sql<MemoryLinkWithSource[]>`
      SELECT ml.*,
             m.content as source_content,
             m.summary as source_summary,
             m.memory_type as source_memory_type,
             m.importance as source_importance
      FROM memory.memory_links ml
      JOIN memory.memories m ON m.id = ml.source_id
      WHERE ml.target_id = ${memoryId}
        AND ml.link_type = ${linkType}
      ORDER BY ml.created_at ASC
    `;
  }
  return sql<MemoryLinkWithSource[]>`
    SELECT ml.*,
           m.content as source_content,
           m.summary as source_summary,
           m.memory_type as source_memory_type,
           m.importance as source_importance
    FROM memory.memory_links ml
    JOIN memory.memories m ON m.id = ml.source_id
    WHERE ml.target_id = ${memoryId}
    ORDER BY ml.link_type, ml.created_at ASC
  `;
}

/**
 * Get all links for a memory (both incoming and outgoing).
 */
export async function getAllLinksForMemory(
  sql: Sql,
  memoryId: string,
): Promise<{ outgoing: MemoryLinkWithTarget[]; incoming: MemoryLinkWithSource[] }> {
  const [outgoing, incoming] = await Promise.all([
    getOutgoingLinks(sql, memoryId),
    getIncomingLinks(sql, memoryId),
  ]);
  return { outgoing, incoming };
}

/**
 * Traverse memory graph up to N hops from a source memory.
 */
export async function traverseMemoryGraph(
  sql: Sql,
  startMemoryId: string,
  hops = 2,
  linkTypes?: LinkType[],
): Promise<Map<string, { memory_id: string; content: string; distance: number; link_type: LinkType }>> {
  const visited = new Map<string, { memory_id: string; content: string; distance: number; link_type: LinkType }>();
  const queue: Array<{ id: string; distance: number; link_type: LinkType }> = [
    { id: startMemoryId, distance: 0, link_type: "related" as LinkType },
  ];

  while (queue.length > 0) {
    const { id, distance, link_type } = queue.shift()!;
    if (visited.has(id) || distance > hops) continue;

    const [row] = await sql<{ id: string; content: string }[]>`
      SELECT id, content FROM memory.memories WHERE id = ${id}
    `;
    if (!row) continue;

    visited.set(id, { memory_id: id, content: row.content, distance, link_type });

    if (distance < hops) {
      let links: MemoryLink[];
      if (linkTypes && linkTypes.length > 0) {
        links = await sql.unsafe(`
          SELECT * FROM memory.memory_links
          WHERE source_id = $1 AND link_type = ANY($2)
        `, [id, linkTypes]) as MemoryLink[];
      } else {
        links = await sql.unsafe(`
          SELECT * FROM memory.memory_links WHERE source_id = $1
        `, [id]) as MemoryLink[];
      }

      for (const link of links) {
        if (!visited.has(link.target_id)) {
          queue.push({ id: link.target_id, distance: distance + 1, link_type: link.link_type });
        }
      }
    }
  }

  return visited;
}

/**
 * Get link statistics for a memory.
 */
export async function getMemoryLinkStats(
  sql: Sql,
  memoryId: string,
): Promise<{ outgoing_count: number; incoming_count: number; by_type: Record<string, number> }> {
  const [outgoing] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count FROM memory.memory_links WHERE source_id = ${memoryId}
  `;
  const [incoming] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count FROM memory.memory_links WHERE target_id = ${memoryId}
  `;
  const byType = await sql<{ link_type: LinkType; count: number }[]>`
    SELECT link_type, COUNT(*) as count
    FROM memory.memory_links
    WHERE source_id = ${memoryId} OR target_id = ${memoryId}
    GROUP BY link_type
  `;

  const typeMap: Record<string, number> = {};
  for (const r of byType) typeMap[r.link_type] = Number(r.count);

  return {
    outgoing_count: Number(outgoing?.count ?? 0),
    incoming_count: Number(incoming?.count ?? 0),
    by_type: typeMap,
  };
}
