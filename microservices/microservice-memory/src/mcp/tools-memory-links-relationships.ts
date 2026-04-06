// --- Memory links / relationships ---

server.tool(
  "memory_link_memories",
  "Create a link between two memories",
  {
    source_id: z.string().describe("Source memory UUID"),
    target_id: z.string().describe("Target memory UUID"),
    link_type: z.enum(["parent", "child", "related", "references", "derived_from"]).describe("Type of link"),
    label: z.string().optional().describe("Optional label for the link"),
  },
  async ({ source_id, target_id, link_type, label }) =>
    text(await linkMemories(sql, source_id, target_id, link_type, label)),
);

server.tool(
  "memory_unlink_memories",
  "Remove a link between two memories",
  {
    source_id: z.string().describe("Source memory UUID"),
    target_id: z.string().describe("Target memory UUID"),
    link_type: z.enum(["parent", "child", "related", "references", "derived_from"]).optional(),
  },
  async ({ source_id, target_id, link_type }) =>
    text({ deleted: await unlinkMemories(sql, source_id, target_id, link_type) }),
);

server.tool(
  "memory_get_outgoing_links",
  "Get all outgoing links from a memory (what this memory references)",
  {
    memory_id: z.string().describe("Memory UUID"),
    link_type: z.enum(["parent", "child", "related", "references", "derived_from"]).optional(),
  },
  async ({ memory_id, link_type }) =>
    text(await getOutgoingLinks(sql, memory_id, link_type)),
);

server.tool(
  "memory_get_incoming_links",
  "Get all incoming links to a memory (what references this memory)",
  {
    memory_id: z.string().describe("Memory UUID"),
    link_type: z.enum(["parent", "child", "related", "references", "derived_from"]).optional(),
  },
  async ({ memory_id, link_type }) =>
    text(await getIncomingLinks(sql, memory_id, link_type)),
);

server.tool(
  "memory_traverse_graph",
  "Traverse the memory graph N hops from a starting memory",
  {
    start_memory_id: z.string().describe("Starting memory UUID"),
    hops: z.number().int().min(1).max(5).optional().default(2),
    link_types: z.array(z.enum(["parent", "child", "related", "references", "derived_from"])).optional(),
  },
  async ({ start_memory_id, hops, link_types }) => {
    const visited = await traverseMemoryGraph(sql, start_memory_id, hops, link_types);
    return text(Object.fromEntries(visited));
  },
);

server.tool(
  "memory_search_across_namespaces",
  "Search memories across multiple namespaces simultaneously",
  {
    workspace_id: z.string(),
    query: z.string(),
    namespaces: z.array(z.string()).optional(),
    memory_types: z.array(MemoryTypeEnum).optional(),
    limit: z.number().optional().default(20),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, query, namespaces, memory_types, limit, offset }) =>
    text(await searchAcrossNamespaces(sql, { workspaceId: workspace_id, query, namespaces, memoryTypes: memory_types, limit, offset })),
);

server.tool(
  "memory_link_stats",
  "Get link count and type breakdown for a memory",
  { memory_id: z.string().describe("Memory UUID") },
  async ({ memory_id }) => text(await getMemoryLinkStats(sql, memory_id)),
);

