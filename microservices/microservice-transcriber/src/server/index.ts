#!/usr/bin/env bun

/**
 * REST API server + web dashboard for microservice-transcriber.
 * Serves a single-page HTML dashboard and JSON API endpoints.
 */

import {
  listTranscripts,
  getTranscript,
  searchTranscripts,
  searchWithContext,
  countTranscripts,
  deleteTranscript,
  getTags,
  listAllTags,
} from "../db/transcripts.js";

const PORT = parseInt(process.env["PORT"] ?? "19600");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function cors(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") return cors();

    // --- API Routes ---
    if (path === "/api/transcripts" && req.method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      const provider = url.searchParams.get("provider") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      const offset = parseInt(url.searchParams.get("offset") ?? "0");
      const transcripts = listTranscripts({ status: status as any, provider: provider as any, limit, offset });
      return json(transcripts);
    }

    if (path === "/api/transcripts/stats" && req.method === "GET") {
      return json(countTranscripts());
    }

    if (path === "/api/tags" && req.method === "GET") {
      return json(listAllTags());
    }

    if (path === "/api/search" && req.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const context = url.searchParams.get("context");
      if (context) {
        return json(searchWithContext(q, parseInt(context)));
      }
      return json(searchTranscripts(q));
    }

    if (path.startsWith("/api/transcripts/") && req.method === "GET") {
      const id = path.split("/")[3];
      const t = getTranscript(id);
      if (!t) return json({ error: "Not found" }, 404);
      const tags = getTags(id);
      return json({ ...t, tags });
    }

    if (path.startsWith("/api/transcripts/") && req.method === "DELETE") {
      const id = path.split("/")[3];
      const deleted = deleteTranscript(id);
      if (!deleted) return json({ error: "Not found" }, 404);
      return json({ id, deleted: true });
    }

    // --- Dashboard (SPA) ---
    return new Response(DASHBOARD_HTML, {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`Transcriber dashboard running at http://localhost:${PORT}`);

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transcriber Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; }
    .container { max-width: 1000px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 1.5rem; margin-bottom: 20px; color: #fff; }
    .stats { display: flex; gap: 12px; margin-bottom: 20px; }
    .stat { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 12px 16px; flex: 1; }
    .stat-value { font-size: 1.5rem; font-weight: bold; color: #10b981; }
    .stat-label { font-size: 0.75rem; color: #888; margin-top: 2px; }
    .search { margin-bottom: 20px; }
    .search input { width: 100%; padding: 10px 14px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.9rem; }
    .search input:focus { outline: none; border-color: #10b981; }
    .list { display: flex; flex-direction: column; gap: 8px; }
    .item { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 14px 16px; cursor: pointer; transition: border-color 0.2s; }
    .item:hover { border-color: #10b981; }
    .item-title { font-weight: 600; color: #fff; margin-bottom: 4px; }
    .item-meta { font-size: 0.8rem; color: #888; display: flex; gap: 12px; }
    .badge { background: #10b98120; color: #10b981; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; }
    .badge.failed { background: #ef444420; color: #ef4444; }
    .detail { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 20px; margin-top: 8px; }
    .detail pre { white-space: pre-wrap; font-size: 0.85rem; line-height: 1.6; max-height: 400px; overflow-y: auto; margin-top: 12px; padding: 12px; background: #111; border-radius: 6px; }
    .back { color: #10b981; cursor: pointer; margin-bottom: 12px; display: inline-block; }
    .tags { display: flex; gap: 4px; margin-top: 6px; }
    .tag { background: #333; padding: 2px 6px; border-radius: 3px; font-size: 0.7rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Transcriber</h1>
    <div id="app"></div>
  </div>
  <script>
    const API = '';
    const app = document.getElementById('app');

    async function api(path) {
      const res = await fetch(API + path);
      return res.json();
    }

    async function renderList(query) {
      const path = query ? '/api/search?q=' + encodeURIComponent(query) : '/api/transcripts?limit=50';
      const [items, stats] = await Promise.all([api(path), api('/api/transcripts/stats')]);

      app.innerHTML = \`
        <div class="stats">
          <div class="stat"><div class="stat-value">\${stats.total}</div><div class="stat-label">Total</div></div>
          <div class="stat"><div class="stat-value">\${stats.by_status?.completed ?? 0}</div><div class="stat-label">Completed</div></div>
          <div class="stat"><div class="stat-value">\${stats.by_status?.failed ?? 0}</div><div class="stat-label">Failed</div></div>
        </div>
        <div class="search"><input type="text" placeholder="Search transcripts..." value="\${query || ''}" id="search"></div>
        <div class="list">\${items.map(t => \`
          <div class="item" onclick="renderDetail('\${t.id}')">
            <div class="item-title">\${t.title || t.source_url || '(untitled)'}</div>
            <div class="item-meta">
              <span class="badge \${t.status === 'failed' ? 'failed' : ''}">\${t.status}</span>
              <span>\${t.provider}</span>
              <span>\${t.source_type}</span>
              \${t.duration_seconds ? '<span>' + Math.floor(t.duration_seconds/60) + 'm</span>' : ''}
              \${t.word_count ? '<span>' + t.word_count + ' words</span>' : ''}
            </div>
          </div>
        \`).join('')}</div>
      \`;

      document.getElementById('search').addEventListener('input', e => {
        clearTimeout(window._st);
        window._st = setTimeout(() => renderList(e.target.value), 300);
      });
    }

    async function renderDetail(id) {
      const t = await api('/api/transcripts/' + id);
      app.innerHTML = \`
        <span class="back" onclick="renderList()">&larr; Back</span>
        <div class="detail">
          <h2 style="color:#fff;margin-bottom:8px">\${t.title || '(untitled)'}</h2>
          <div class="item-meta" style="margin-bottom:8px">
            <span class="badge">\${t.status}</span>
            <span>\${t.provider}</span>
            <span>\${t.source_type}</span>
            \${t.duration_seconds ? '<span>' + Math.floor(t.duration_seconds/60) + 'm ' + Math.floor(t.duration_seconds%60) + 's</span>' : ''}
            \${t.metadata?.cost_usd ? '<span>$' + t.metadata.cost_usd.toFixed(4) + '</span>' : ''}
          </div>
          \${t.source_url ? '<div style="font-size:0.8rem;color:#888;margin-bottom:8px"><a href="' + t.source_url + '" target="_blank" style="color:#10b981">' + t.source_url + '</a></div>' : ''}
          \${t.tags?.length ? '<div class="tags">' + t.tags.map(tag => '<span class="tag">' + tag + '</span>').join('') + '</div>' : ''}
          \${t.metadata?.summary ? '<div style="margin-top:12px;padding:10px;background:#111;border-radius:6px;font-size:0.85rem"><strong>Summary:</strong> ' + t.metadata.summary + '</div>' : ''}
          <pre>\${t.transcript_text || '(no text)'}</pre>
        </div>
      \`;
    }

    renderList();
  </script>
</body>
</html>`;
