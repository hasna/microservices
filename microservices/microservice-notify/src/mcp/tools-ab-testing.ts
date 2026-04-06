// ─── A/B Testing ──────────────────────────────────────────────────────────────

server.tool(
  "notify_create_ab_test",
  "Create a new A/B test with multiple notification variants",
  {
    workspace_id: z.string().describe("Workspace ID"),
    name: z.string().describe("Test name"),
    description: z.string().optional(),
    variants: z.array(z.object({
      name: z.string(),
      template_id: z.string().optional(),
      subject_template: z.string().optional(),
      body_template: z.string().optional(),
      channel: z.string(),
      send_delay_seconds: z.number().optional(),
      weight: z.number().int().min(0).max(100),
    })).min(2).describe("At least 2 variants required"),
    target_user_ids: z.array(z.string()),
    start_at: z.string().optional(),
    end_at: z.string().optional(),
  },
  async (opts) => text(await createABTest(sql, {
    workspaceId: opts.workspace_id,
    name: opts.name,
    description: opts.description,
    variants: opts.variants,
    targetUserIds: opts.target_user_ids,
    startAt: opts.start_at,
    endAt: opts.end_at,
  })),
);

server.tool(
  "notify_get_ab_test",
  "Get an A/B test with its variants",
  { test_id: z.string() },
  async ({ test_id }) => text(await getABTest(sql, test_id)),
);

server.tool(
  "notify_list_ab_tests",
  "List A/B tests for a workspace",
  {
    workspace_id: z.string(),
    status: z.enum(["draft", "running", "paused", "completed", "cancelled"]).optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, status, limit }) =>
    text(await listABTests(sql, workspace_id, { status, limit })),
);

server.tool(
  "notify_get_ab_test_results",
  "Get results for all variants in an A/B test",
  { test_id: z.string() },
  async ({ test_id }) => text(await getABTestResults(sql, test_id)),
);

server.tool(
  "notify_record_ab_conversion",
  "Record a conversion event for an A/B test variant (send, open, or click)",
  {
    variant_id: z.string().describe("Variant ID"),
    event_type: z.enum(["send", "open", "click"]),
  },
  async ({ variant_id, event_type }) => {
    await recordABConversion(sql, variant_id, event_type);
    return text({ recorded: true });
  },
);

server.tool(
  "notify_complete_ab_test",
  "Complete an A/B test and determine the winning variant",
  { test_id: z.string() },
  async ({ test_id }) => text(await completeABTest(sql, test_id)),
);

