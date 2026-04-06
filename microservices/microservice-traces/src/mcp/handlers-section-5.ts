  // Grafana dashboard handler
  if (name === "traces_generate_grafana_dashboard") {
    return text(generateGrafanaDashboard({
      workspaceId: String(a.workspace_id),
      title: a.title ? String(a.title) : undefined,
      uid: a.uid ? String(a.uid) : undefined,
      refreshInterval: a.refresh_interval ? String(a.refresh_interval) : undefined,
    }));
  }

