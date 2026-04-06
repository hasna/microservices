    // Grafana dashboard export
    {
      name: "traces_generate_grafana_dashboard",
      description: "Generate a Grafana dashboard JSON for a workspace's traces — import into Grafana to get a full trace overview dashboard",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          title: { type: "string", description: "Dashboard title (default: Hasna Traces Overview)" },
          uid: { type: "string", description: "Dashboard UID (default: auto-generated)" },
          refresh_interval: { type: "string", description: "Refresh interval (default: 5m)" },
        },
        required: ["workspace_id"],
      },
    },
