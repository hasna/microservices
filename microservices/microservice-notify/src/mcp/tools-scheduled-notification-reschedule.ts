// --- Scheduled notification reschedule ---

server.tool(
  "notify_reschedule_scheduled",
  "Reschedule a pending standalone scheduled notification to a new time",
  {
    id: z.string(),
    new_scheduled_for: z.string().describe("New ISO 8601 datetime"),
  },
  async ({ id, new_scheduled_for }) => {
    const result = await rescheduleScheduled(sql, id, new_scheduled_for);
    return text({ scheduled: result });
  },
);

