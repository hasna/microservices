// ─── Prometheus Text Format Utility ─────────────────────────────────────────

server.tool(
  "guardrails_format_prometheus",
  "Convert guardrails metrics JSON to Prometheus text exposition format",
  {
    metrics_json: z.string().describe("JSON metrics object from guardrails_metrics_json"),
    include_prefix: z.boolean().optional().default(true).describe("Include metric name prefixes"),
  },
  async ({ metrics_json, include_prefix }) => {
    const { toPrometheusTextFormat } = await import("../lib/guardrails-metrics.js");
    const metrics = JSON.parse(metrics_json);
    return text({ prometheus: toPrometheusTextFormat(metrics, include_prefix ?? true) });
  },
);

