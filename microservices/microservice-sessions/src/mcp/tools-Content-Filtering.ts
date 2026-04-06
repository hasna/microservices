    // ─── Content Filtering ────────────────────────────────────────────────────────
    {
      name: "sessions_redact_content",
      description: "Redact PII/sensitive content from text (email, phone, SSN, credit card, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          patterns: {
            type: "array",
            items: { type: "string", enum: ["email", "phone", "ssn", "credit_card", "ip_address", "api_key", "password", "jwt"] },
            description: "Which patterns to redact (defaults to all common patterns)",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "sessions_detect_sensitive",
      description: "Detect and report sensitive content without redacting",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
    },
    {
      name: "sessions_redact_messages",
      description: "Redact PII from a batch of messages",
      inputSchema: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
              },
              required: ["content"],
            },
          },
          patterns: {
            type: "array",
            items: { type: "string", enum: ["email", "phone", "ssn", "credit_card", "ip_address", "api_key", "password", "jwt"] },
          },
        },
        required: ["messages"],
      },
    },

