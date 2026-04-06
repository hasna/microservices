// ─── Targeted PII Detectors ──────────────────────────────────────────────────

server.tool(
  "guardrails_detect_ip_address",
  "Detect IP addresses (IPv4 and IPv6) in text",
  { text: z.string().describe("Text to scan") },
  async ({ text }) => text({ matches: detectIPAddress(text) }),
);

server.tool(
  "guardrails_detect_date_of_birth",
  "Detect dates of birth in various formats (MM/DD/YYYY, YYYY-MM-DD, Month DD YYYY)",
  { text: z.string().describe("Text to scan") },
  async ({ text }) => text({ matches: detectDateOfBirth(text) }),
);

server.tool(
  "guardrails_detect_license_plate",
  "Detect vehicle license plates (US and EU formats)",
  { text: z.string().describe("Text to scan") },
  async ({ text }) => text({ matches: detectLicensePlate(text) }),
);

server.tool(
  "guardrails_detect_medical_license",
  "Detect medical license / NPI numbers (US 10-digit provider identifiers)",
  { text: z.string().describe("Text to scan") },
  async ({ text }) => text({ matches: detectMedicalLicense(text) }),
);

