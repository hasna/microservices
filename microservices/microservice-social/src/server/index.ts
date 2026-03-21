#!/usr/bin/env bun

/**
 * REST API server + web dashboard for microservice-social.
 * Serves a single-page HTML dashboard and JSON API endpoints.
 */

import {
  listPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  publishPost,
  listAccounts,
  getCalendar,
  getOverallStats,
  getEngagementStats,
  type PostStatus,
} from "../db/social.js";
import { listMentions } from "../lib/mentions.js";

const PORT = parseInt(process.env["PORT"] ?? "19650");

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
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

    try {
      // --- API Routes ---

      // POST /api/posts/:id/publish — must come before generic /api/posts/:id
      if (path.match(/^\/api\/posts\/[^/]+\/publish$/) && req.method === "POST") {
        const id = path.split("/")[3];
        const post = publishPost(id);
        if (!post) return json({ error: "Not found" }, 404);
        return json(post);
      }

      // GET /api/posts — list posts
      if (path === "/api/posts" && req.method === "GET") {
        const status = url.searchParams.get("status") ?? undefined;
        const search = url.searchParams.get("search") ?? undefined;
        const limit = parseInt(url.searchParams.get("limit") ?? "50");
        const offset = parseInt(url.searchParams.get("offset") ?? "0");
        const posts = listPosts({ status: status as PostStatus | undefined, search, limit, offset });
        return json(posts);
      }

      // POST /api/posts — create post
      if (path === "/api/posts" && req.method === "POST") {
        const body = await req.json();
        if (!body.account_id || !body.content) {
          return json({ error: "account_id and content are required" }, 422);
        }
        const post = createPost({
          account_id: body.account_id,
          content: body.content,
          media_urls: body.media_urls,
          status: body.status,
          scheduled_at: body.scheduled_at,
          tags: body.tags,
          recurrence: body.recurrence,
        });
        return json(post, 201);
      }

      // GET /api/posts/:id — single post
      if (path.match(/^\/api\/posts\/[^/]+$/) && req.method === "GET") {
        const id = path.split("/")[3];
        const post = getPost(id);
        if (!post) return json({ error: "Not found" }, 404);
        return json(post);
      }

      // PUT /api/posts/:id — update post
      if (path.match(/^\/api\/posts\/[^/]+$/) && req.method === "PUT") {
        const id = path.split("/")[3];
        const body = await req.json();
        const post = updatePost(id, body);
        if (!post) return json({ error: "Not found" }, 404);
        return json(post);
      }

      // DELETE /api/posts/:id — delete post
      if (path.match(/^\/api\/posts\/[^/]+$/) && req.method === "DELETE") {
        const id = path.split("/")[3];
        const deleted = deletePost(id);
        if (!deleted) return json({ error: "Not found" }, 404);
        return json({ id, deleted: true });
      }

      // GET /api/accounts — list accounts
      if (path === "/api/accounts" && req.method === "GET") {
        const accounts = listAccounts();
        return json(accounts);
      }

      // GET /api/calendar — calendar view
      if (path === "/api/calendar" && req.method === "GET") {
        const from = url.searchParams.get("from") ?? undefined;
        const to = url.searchParams.get("to") ?? undefined;
        return json(getCalendar(from, to));
      }

      // GET /api/analytics — overall stats
      if (path === "/api/analytics" && req.method === "GET") {
        return json(getOverallStats());
      }

      // GET /api/mentions — mentions list
      if (path === "/api/mentions" && req.method === "GET") {
        const account_id = url.searchParams.get("account_id") ?? undefined;
        const unreadParam = url.searchParams.get("unread");
        const unread = unreadParam === "true" ? true : unreadParam === "false" ? false : undefined;
        const mentions = listMentions(account_id, { unread });
        return json(mentions);
      }

      // GET /api/stats — engagement stats
      if (path === "/api/stats" && req.method === "GET") {
        return json(getEngagementStats());
      }

      // --- Dashboard (SPA) ---
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
});

console.log(`Social dashboard running at http://localhost:${PORT}`);

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Social Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; }
    .container { max-width: 1100px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 1.5rem; margin-bottom: 20px; color: #fff; }
    h2 { font-size: 1.1rem; margin-bottom: 12px; color: #ccc; }

    /* Tabs */
    .tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 8px; }
    .tab { padding: 8px 16px; background: none; border: none; color: #888; cursor: pointer; font-size: 0.9rem; border-radius: 6px 6px 0 0; }
    .tab:hover { color: #fff; background: #1a1a1a; }
    .tab.active { color: #10b981; background: #1a1a1a; border-bottom: 2px solid #10b981; }

    /* Stats cards */
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .stat { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 14px 16px; }
    .stat-value { font-size: 1.6rem; font-weight: bold; color: #10b981; }
    .stat-label { font-size: 0.75rem; color: #888; margin-top: 2px; }

    /* Search */
    .search { margin-bottom: 20px; }
    .search input { width: 100%; padding: 10px 14px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.9rem; }
    .search input:focus { outline: none; border-color: #10b981; }

    /* List */
    .list { display: flex; flex-direction: column; gap: 8px; }
    .item { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 14px 16px; cursor: pointer; transition: border-color 0.2s; }
    .item:hover { border-color: #10b981; }
    .item-title { font-weight: 600; color: #fff; margin-bottom: 4px; }
    .item-meta { font-size: 0.8rem; color: #888; display: flex; gap: 12px; flex-wrap: wrap; }

    /* Badges */
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
    .badge-draft { background: #6b728020; color: #9ca3af; }
    .badge-scheduled { background: #3b82f620; color: #60a5fa; }
    .badge-published { background: #10b98120; color: #10b981; }
    .badge-failed { background: #ef444420; color: #ef4444; }
    .badge-pending_review { background: #f59e0b20; color: #f59e0b; }

    /* Detail view */
    .detail { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 20px; margin-top: 8px; }
    .detail pre { white-space: pre-wrap; font-size: 0.85rem; line-height: 1.6; max-height: 400px; overflow-y: auto; margin-top: 12px; padding: 12px; background: #111; border-radius: 6px; }
    .back { color: #10b981; cursor: pointer; margin-bottom: 12px; display: inline-block; }

    /* Tags */
    .tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
    .tag { background: #333; padding: 2px 6px; border-radius: 3px; font-size: 0.7rem; }

    /* Calendar */
    .cal-date { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 14px 16px; margin-bottom: 8px; }
    .cal-date-header { font-weight: 600; color: #60a5fa; margin-bottom: 8px; font-size: 0.9rem; }
    .cal-post { font-size: 0.85rem; padding: 6px 0; border-top: 1px solid #222; color: #ccc; }
    .cal-post:first-child { border-top: none; }
    .cal-time { color: #888; font-size: 0.75rem; margin-right: 8px; }

    /* Mentions */
    .mention { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; }
    .mention.unread { border-left: 3px solid #f59e0b; }
    .mention-author { font-weight: 600; color: #fff; font-size: 0.9rem; }
    .mention-content { font-size: 0.85rem; color: #ccc; margin-top: 4px; }
    .mention-meta { font-size: 0.75rem; color: #888; margin-top: 4px; }

    /* Accounts */
    .account-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 14px 16px; }
    .account-handle { font-weight: 600; color: #fff; }
    .account-platform { font-size: 0.8rem; color: #60a5fa; text-transform: uppercase; }
    .connected { color: #10b981; }
    .disconnected { color: #ef4444; }

    .empty { text-align: center; color: #666; padding: 40px; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Social Dashboard</h1>
    <div class="tabs">
      <button class="tab active" data-tab="overview" onclick="switchTab('overview')">Overview</button>
      <button class="tab" data-tab="posts" onclick="switchTab('posts')">Posts</button>
      <button class="tab" data-tab="calendar" onclick="switchTab('calendar')">Calendar</button>
      <button class="tab" data-tab="mentions" onclick="switchTab('mentions')">Mentions</button>
      <button class="tab" data-tab="accounts" onclick="switchTab('accounts')">Accounts</button>
    </div>
    <div id="app"></div>
  </div>
  <script>
    const API = '';
    const app = document.getElementById('app');
    let currentTab = 'overview';

    async function api(path) {
      const res = await fetch(API + path);
      return res.json();
    }

    function esc(s) {
      if (!s) return '';
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function badgeClass(status) {
      return 'badge badge-' + (status || 'draft');
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
      render();
    }

    function render() {
      switch (currentTab) {
        case 'overview': renderOverview(); break;
        case 'posts': renderPosts(); break;
        case 'calendar': renderCalendar(); break;
        case 'mentions': renderMentions(); break;
        case 'accounts': renderAccounts(); break;
      }
    }

    async function renderOverview() {
      const [analytics, stats, mentions] = await Promise.all([
        api('/api/analytics'),
        api('/api/stats'),
        api('/api/mentions?unread=true'),
      ]);

      const engRate = stats.total_posts > 0
        ? ((stats.total_likes + stats.total_shares + stats.total_comments) / Math.max(stats.total_impressions, 1) * 100).toFixed(1)
        : '0.0';

      app.innerHTML = \`
        <div class="stats">
          <div class="stat"><div class="stat-value">\${analytics.total_posts}</div><div class="stat-label">Total Posts</div></div>
          <div class="stat"><div class="stat-value">\${analytics.posts_by_status?.scheduled ?? 0}</div><div class="stat-label">Scheduled</div></div>
          <div class="stat"><div class="stat-value">\${analytics.posts_by_status?.published ?? 0}</div><div class="stat-label">Published</div></div>
          <div class="stat"><div class="stat-value">\${engRate}%</div><div class="stat-label">Engagement Rate</div></div>
          <div class="stat"><div class="stat-value">\${analytics.total_accounts}</div><div class="stat-label">Accounts</div></div>
          <div class="stat"><div class="stat-value">\${mentions.length}</div><div class="stat-label">Unread Mentions</div></div>
        </div>
        <h2>Engagement</h2>
        <div class="stats" style="margin-bottom:20px">
          <div class="stat"><div class="stat-value">\${analytics.engagement.total_likes}</div><div class="stat-label">Likes</div></div>
          <div class="stat"><div class="stat-value">\${analytics.engagement.total_shares}</div><div class="stat-label">Shares</div></div>
          <div class="stat"><div class="stat-value">\${analytics.engagement.total_comments}</div><div class="stat-label">Comments</div></div>
          <div class="stat"><div class="stat-value">\${analytics.engagement.total_impressions}</div><div class="stat-label">Impressions</div></div>
          <div class="stat"><div class="stat-value">\${analytics.engagement.total_clicks}</div><div class="stat-label">Clicks</div></div>
        </div>
      \`;
    }

    async function renderPosts(query) {
      const qs = query ? '?search=' + encodeURIComponent(query) + '&limit=50' : '?limit=50';
      const posts = await api('/api/posts' + qs);

      app.innerHTML = \`
        <div class="search"><input type="text" placeholder="Search posts..." value="\${esc(query || '')}" id="search"></div>
        <div class="list">\${posts.length === 0 ? '<div class="empty">No posts found.</div>' : posts.map(p => \`
          <div class="item" onclick="renderPostDetail('\${p.id}')">
            <div class="item-title">\${esc(p.content.substring(0, 100))}\${p.content.length > 100 ? '...' : ''}</div>
            <div class="item-meta">
              <span class="\${badgeClass(p.status)}">\${p.status}</span>
              \${p.scheduled_at ? '<span>Scheduled: ' + esc(p.scheduled_at) + '</span>' : ''}
              \${p.published_at ? '<span>Published: ' + esc(p.published_at) + '</span>' : ''}
              \${Object.keys(p.engagement || {}).length ? '<span>Likes: ' + (p.engagement.likes || 0) + ' Shares: ' + (p.engagement.shares || 0) + '</span>' : ''}
            </div>
            \${p.tags && p.tags.length ? '<div class="tags">' + p.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : ''}
          </div>
        \`).join('')}</div>
      \`;

      document.getElementById('search').addEventListener('input', e => {
        clearTimeout(window._st);
        window._st = setTimeout(() => renderPosts(e.target.value), 300);
      });
    }

    async function renderPostDetail(id) {
      const p = await api('/api/posts/' + id);
      if (p.error) { renderPosts(); return; }

      app.innerHTML = \`
        <span class="back" onclick="switchTab('posts')">&larr; Back to Posts</span>
        <div class="detail">
          <div class="item-meta" style="margin-bottom:12px">
            <span class="\${badgeClass(p.status)}">\${p.status}</span>
            <span>Account: \${esc(p.account_id)}</span>
            \${p.scheduled_at ? '<span>Scheduled: ' + esc(p.scheduled_at) + '</span>' : ''}
            \${p.published_at ? '<span>Published: ' + esc(p.published_at) + '</span>' : ''}
          </div>
          \${p.tags && p.tags.length ? '<div class="tags" style="margin-bottom:12px">' + p.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : ''}
          <pre>\${esc(p.content)}</pre>
          \${Object.keys(p.engagement || {}).length ? '<div style="margin-top:12px"><h2>Engagement</h2><div class="stats"><div class="stat"><div class="stat-value">' + (p.engagement.likes||0) + '</div><div class="stat-label">Likes</div></div><div class="stat"><div class="stat-value">' + (p.engagement.shares||0) + '</div><div class="stat-label">Shares</div></div><div class="stat"><div class="stat-value">' + (p.engagement.comments||0) + '</div><div class="stat-label">Comments</div></div><div class="stat"><div class="stat-value">' + (p.engagement.impressions||0) + '</div><div class="stat-label">Impressions</div></div></div></div>' : ''}
          \${p.media_urls && p.media_urls.length ? '<div style="margin-top:12px"><strong>Media:</strong> ' + p.media_urls.map(u => '<a href="' + esc(u) + '" target="_blank" style="color:#10b981">' + esc(u) + '</a>').join(', ') + '</div>' : ''}
        </div>
      \`;
    }

    async function renderCalendar() {
      const cal = await api('/api/calendar');
      const dates = Object.keys(cal).sort();

      if (dates.length === 0) {
        app.innerHTML = '<div class="empty">No scheduled posts.</div>';
        return;
      }

      app.innerHTML = dates.map(date => \`
        <div class="cal-date">
          <div class="cal-date-header">\${date}</div>
          \${cal[date].map(p => \`
            <div class="cal-post">
              <span class="cal-time">\${p.scheduled_at ? p.scheduled_at.split(' ')[1] || p.scheduled_at.split('T')[1] || '' : ''}</span>
              \${esc(p.content.substring(0, 80))}\${p.content.length > 80 ? '...' : ''}
            </div>
          \`).join('')}
        </div>
      \`).join('');
    }

    async function renderMentions() {
      const mentions = await api('/api/mentions');

      if (mentions.length === 0) {
        app.innerHTML = '<div class="empty">No mentions.</div>';
        return;
      }

      const unreadCount = mentions.filter(m => !m.read).length;
      app.innerHTML = \`
        <div class="stats" style="margin-bottom:16px">
          <div class="stat"><div class="stat-value">\${mentions.length}</div><div class="stat-label">Total Mentions</div></div>
          <div class="stat"><div class="stat-value">\${unreadCount}</div><div class="stat-label">Unread</div></div>
        </div>
        <div class="list">\${mentions.map(m => \`
          <div class="mention \${m.read ? '' : 'unread'}">
            <div class="mention-author">\${m.author_handle ? '@' + esc(m.author_handle) : esc(m.author) || 'Unknown'}</div>
            <div class="mention-content">\${esc(m.content) || '(no content)'}</div>
            <div class="mention-meta">
              \${m.type ? '<span class="badge badge-draft">' + m.type + '</span>' : ''}
              <span>\${esc(m.platform)}</span>
              \${m.sentiment ? '<span>Sentiment: ' + esc(m.sentiment) + '</span>' : ''}
              <span>\${esc(m.fetched_at)}</span>
            </div>
          </div>
        \`).join('')}</div>
      \`;
    }

    async function renderAccounts() {
      const accounts = await api('/api/accounts');

      if (accounts.length === 0) {
        app.innerHTML = '<div class="empty">No accounts connected.</div>';
        return;
      }

      app.innerHTML = \`
        <div class="grid-2">\${accounts.map(a => \`
          <div class="account-card">
            <div class="account-platform">\${esc(a.platform)}</div>
            <div class="account-handle">@\${esc(a.handle)}</div>
            \${a.display_name ? '<div style="font-size:0.85rem;color:#aaa">' + esc(a.display_name) + '</div>' : ''}
            <div style="margin-top:6px;font-size:0.8rem" class="\${a.connected ? 'connected' : 'disconnected'}">\${a.connected ? 'Connected' : 'Disconnected'}</div>
          </div>
        \`).join('')}</div>
      \`;
    }

    render();
  </script>
</body>
</html>`;

export { server };
