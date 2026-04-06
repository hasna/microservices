  // ─── Content Filtering ─────────────────────────────────────────────────────────

  if (name === "sessions_redact_content") {
    const { redactContent } = await import("../lib/content-filter.js");
    return text(redactContent(String(a.text), a.patterns as any));
  }

  if (name === "sessions_detect_sensitive") {
    const { detectSensitiveContent } = await import("../lib/content-filter.js");
    return text(detectSensitiveContent(String(a.text)));
  }

  if (name === "sessions_redact_messages") {
    const { redactMessages } = await import("../lib/content-filter.js");
    return text(await redactMessages(a.messages, a.patterns as any));
  }

