// --- Gap: retry DEFAULT_RETRY_CONFIGS ---

server.tool(
  "notify_get_default_retry_configs",
  "Get the default retry configurations per channel (email, sms, in_app, webhook)",
  {},
  async () => text({ configs: DEFAULT_RETRY_CONFIGS }),
);

