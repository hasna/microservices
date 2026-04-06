// --- Template analytics ---
server.tool(
  "notify_get_template_analytics",
  "Get delivery analytics for a template — rendered, delivered, opened, clicked counts and conversion rate",
  {
    template_id: z.number().int(),
    start_date: z.string().optional().describe("ISO date — start of window"),
    end_date: z.string().optional().describe("ISO date — end of window"),
  },
  async ({ template_id, start_date, end_date }) => {
    const startDate = start_date ? new Date(start_date) : undefined;
    const endDate = end_date ? new Date(end_date) : undefined;
    return text(await getTemplateAnalytics(sql, template_id, startDate, endDate));
  },
);

