// --- Digest rendering ---
server.tool(
  "notify_render_digest_body",
  "Render a digest body string from a list of notifications — groups them under a header (hourly/daily/weekly)",
  {
    notifications: z.array(z.object({
      type: z.string(),
      title: z.string().nullable(),
      body: z.string(),
    })),
    frequency: z.enum(["hourly", "daily", "weekly"]),
  },
  async ({ notifications, frequency }) => {
    return text(renderDigestBody(notifications, frequency));
  },
);

