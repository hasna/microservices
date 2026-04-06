// --- Indexing job queue tools ---

server.tool(
  "knowledge_queue_indexing_job",
  "Queue a document for background indexing",
  {
    document_id: z.string().describe("Document ID"),
    workspace_id: z.string().describe("Workspace ID"),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional().default("normal").describe("Job priority"),
    max_attempts: z.number().optional().default(3).describe("Max retry attempts"),
  },
  async ({ document_id, workspace_id, priority, max_attempts }) =>
    text(await queueIndexingJob(sql, document_id, workspace_id, { priority, maxAttempts: max_attempts })),
);

server.tool(
  "knowledge_list_indexing_jobs",
  "List indexing jobs for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    status: z.enum(["pending", "processing", "completed", "failed", "cancelled"]).optional().describe("Filter by status"),
    limit: z.number().optional().default(50).describe("Max results"),
    offset: z.number().optional().default(0).describe("Offset"),
  },
  async ({ workspace_id, status, limit, offset }) =>
    text(await listIndexingJobs(sql, workspace_id, { status, limit, offset })),
);

server.tool(
  "knowledge_get_indexing_job",
  "Get a specific indexing job by ID",
  {
    job_id: z.string().describe("Job ID"),
  },
  async ({ job_id }) => text(await getIndexingJob(sql, job_id)),
);

server.tool(
  "knowledge_cancel_indexing_job",
  "Cancel a pending or failed indexing job",
  {
    job_id: z.string().describe("Job ID"),
  },
  async ({ job_id }) => text(await cancelIndexingJob(sql, job_id)),
);

server.tool(
  "knowledge_process_indexing_queue",
  "Process N pending indexing jobs from the queue (for background workers)",
  {
    count: z.number().optional().default(5).describe("Number of jobs to process"),
  },
  async ({ count }) => {
    const processed = await processIndexingQueue(sql, count);
    return text({ processed });
  },
);

server.tool(
  "knowledge_indexing_queue_stats",
  "Get indexing queue statistics for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
  },
  async ({ workspace_id }) => text(await getIndexingQueueStats(sql, workspace_id)),
);

