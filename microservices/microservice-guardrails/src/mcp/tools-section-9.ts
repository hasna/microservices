// ─── Redact PII from Text ───────────────────────────────────────────────────────

server.tool(
  "guardrails_redact_text",
  "Scan text for PII and redact all detected personally identifiable information — returns redacted text and list of redactions",
  {
    text: z.string().describe("Text to scan and redact"),
    pii_types: z.array(z.string()).optional().describe("PII types to target (default: all detected types)"),
    replacement: z.string().optional().default("[REDACTED]").describe("Replacement string for redacted content"),
  },
  async ({ text, pii_types, replacement }) => {
    const { scanPII, redactPII } = await import("../lib/pii.js");
    const matches = scanPII(text);
    const filtered = pii_types ? matches.filter(m => pii_types.includes(m.type)) : matches;
    const redacted = redactPII(text, filtered);
    return text({ redacted, redactions: filtered, count: filtered.length });
  },
);

