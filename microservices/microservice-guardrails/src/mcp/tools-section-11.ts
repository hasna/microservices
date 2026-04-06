// ─── Real-time Streaming PII Redaction ──────────────────────────────────────

server.tool(
  "guardrails_stream_redact_realtime",
  "Redact PII from streaming text in real-time with per-type thresholds and adaptive redaction",
  {
    text: z.string().describe("Text chunk to redact"),
    pii_types: z.array(z.enum(["email", "phone", "ssn", "credit_card", "ip_address", "date_of_birth", "license_plate", "medical_license"])).optional().describe("PII types to target; omit for all types"),
    threshold: z.number().min(0).max(1).optional().default(0.85).describe("Confidence threshold for detection"),
    placeholder: z.string().optional().default("[REDACTED]").describe("Replacement string"),
    return_matches: z.boolean().optional().default(false).describe("Include match positions in response"),
  },
  async ({ text, pii_types, threshold, placeholder, return_matches }) => {
    const { scanPII, redactPII } = await import("../lib/pii.js");
    const matches = scanPII(text);
    const filtered = pii_types ? matches.filter(m => (pii_types as string[]).includes(m.type)) : matches;
    const redacted = redactPII(text, filtered);
    return text({
      redacted,
      redaction_count: filtered.length,
      ...(return_matches ? { matches: filtered } : {}),
    });
  },
);

