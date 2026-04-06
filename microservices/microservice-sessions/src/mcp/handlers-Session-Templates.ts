  // ─── Session Templates ───────────────────────────────────────────────────────

  if (name === "sessions_get_template") {
    const { getSessionTemplate } = await import("../lib/session-templates.js");
    return text(await getSessionTemplate(sql, String(a.template_id)));
  }

  if (name === "sessions_list_templates") {
    const { listSessionTemplates } = await import("../lib/session-templates.js");
    return text(await listSessionTemplates(sql, String(a.workspace_id), a.limit ? Number(a.limit) : 20));
  }

  if (name === "sessions_render_template") {
    const { renderSessionTemplate } = await import("../lib/session-templates.js");
    return text(await renderSessionTemplate(sql, String(a.template_id), a.variables ? JSON.parse(a.variables) : {}));
  }

