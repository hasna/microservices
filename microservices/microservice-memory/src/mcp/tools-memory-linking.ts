// ─── Memory Linking ──────────────────────────────────────────────────────────

server.tool(
  "memory_link_memories",
  "Create a directed link between two memories (source → target)",
  {
    source_id: z.string().describe("Source memory ID"),
    target_id: z.string().describe("Target memory ID"),
    link_type: z.enum(["related", "follows", "depends_on", "引用", "expands", "contradicts"]).optional().default("related"),
    metadata: z.record(z.any()).optional(),
  },
  async ({ source_id, target_id, link_type, metadata }) => {
    const { linkMemories } = await import("../lib/memory-links.js");
    return text(await linkMemories(sql, source_id, target_id, link_type, metadata));
  },
);

server.tool(
  "memory_unlink_memories",
  "Remove a link between two memories",
  {
    source_id: z.string().describe("Source memory ID"),
    target_id: z.string().describe("Target memory ID"),
  },
  async ({ source_id, target_id }) => {
    const { unlinkMemories } = await import("../lib/memory-links.js");
    return text({ unlinked: await unlinkMemories(sql, source_id, target_id) });
  },
);

server.tool(
  "memory_get_outgoing_links",
  "Get all outgoing links from a memory (what it references)",
  {
    memory_id: z.string(),
    link_type: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ memory_id, link_type, limit }) => {
    const { getOutgoingLinks } = await import("../lib/memory-links.js");
    return text(await getOutgoingLinks(sql, memory_id, link_type, limit));
  },
);

server.tool(
  "memory_get_incoming_links",
  "Get all incoming links to a memory (what references it)",
  {
    memory_id: z.string(),
    link_type: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ memory_id, link_type, limit }) => {
    const { getIncomingLinks } = await import("../lib/memory-links.js");
    return text(await getIncomingLinks(sql, memory_id, link_type, limit));
  },
);

server.tool(
  "memory_traverse_graph",
  "Traverse memory graph starting from a memory, following links up to a max depth",
  {
    start_id: z.string().describe("Starting memory ID"),
    max_depth: z.number().int().positive().optional().default(3),
    direction: z.enum(["outgoing", "incoming", "both"]).optional().default("outgoing"),
    link_types: z.array(z.string()).optional(),
  },
  async ({ start_id, max_depth, direction, link_types }) => {
    const { traverseMemoryGraph } = await import("../lib/memory-links.js");
    return text(await traverseMemoryGraph(sql, start_id, max_depth, direction, link_types));
  },
);

server.tool(
  "memory_get_link_stats",
  "Get memory link statistics: link counts by type, most-linked memories, orphaned memories",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { getMemoryLinkStats } = await import("../lib/memory-links.js");
    return text(await getMemoryLinkStats(sql, workspace_id, namespace));
  },
);

