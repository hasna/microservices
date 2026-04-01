/**
 * API Gateway for @hasna/microservices
 * Routes incoming HTTP requests to the appropriate microservice based on the URL prefix.
 */
import { serve } from "bun";

// Map of URL prefixes to default microservice ports
const SERVICE_PORTS: Record<string, number> = {
  auth: 3000,
  teams: 3002,
  billing: 3003,
  notify: 3004,
  files: 3005,
  audit: 3006,
  flags: 3007,
  jobs: 3008,
  llm: 3009,
  memory: 3010,
  search: 3011,
  knowledge: 3012,
  sessions: 3013,
  guardrails: 3014,
  agents: 3015,
  prompts: 3016,
  traces: 3017,
  usage: 3018,
  waitlist: 3019,
  onboarding: 3020,
  webhooks: 3021,
};

const GATEWAY_PORT = process.env.PORT || 8000;

serve({
  port: GATEWAY_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (pathParts.length === 0) {
      const acceptsHtml = req.headers.get("accept")?.includes("text/html");

      if (acceptsHtml) {
        return new Response(generateDashboardHTML(SERVICE_PORTS), {
          headers: { "Content-Type": "text/html" },
        });
      }

      return new Response(
        JSON.stringify({
          service: "api-gateway",
          status: "ok",
          routes: Object.keys(SERVICE_PORTS).map((name) => `/${name}/*`),
          endpoints: ["/", "/health"],
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Global health check: ping all microservices
    if (pathParts.length === 1 && pathParts[0] === "health") {
      const statuses = await Promise.all(
        Object.entries(SERVICE_PORTS).map(async ([name, port]) => {
          try {
            // Abort if service takes too long to respond
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1500);

            const res = await fetch(`http://localhost:${port}/health`, {
              signal: controller.signal,
              headers: { Accept: "application/json" },
            });
            clearTimeout(timeout);

            return {
              name,
              port,
              status: res.ok ? "up" : "down",
              code: res.status,
            };
          } catch (_err) {
            return { name, port, status: "down", error: "unreachable" };
          }
        }),
      );

      const allUp = statuses.every((s) => s.status === "up");
      const anyUp = statuses.some((s) => s.status === "up");

      let statusCode = 200;
      if (!allUp && anyUp)
        statusCode = 207; // Multi-Status (some up, some down)
      else if (!anyUp) statusCode = 503; // Service Unavailable (all down)

      return new Response(
        JSON.stringify(
          {
            service: "api-gateway",
            status: allUp ? "healthy" : anyUp ? "degraded" : "offline",
            timestamp: new Date().toISOString(),
            services: statuses,
          },
          null,
          2,
        ),
        {
          status: statusCode,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Handle CORS preflight at the gateway level
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods":
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const serviceName = pathParts[0];
    const port = SERVICE_PORTS[serviceName];

    if (!port) {
      return new Response(JSON.stringify({ error: "Service not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Proxy the request
    const targetUrl = new URL(req.url);
    targetUrl.port = port.toString();
    targetUrl.hostname = "localhost";

    try {
      // Create a new request to forward, copying method, headers, and body
      const proxyReq = new Request(targetUrl.toString(), {
        method: req.method,
        headers: req.headers,
        body: req.body,
        redirect: "manual",
      });

      const response = await fetch(proxyReq);

      // Inject global CORS headers into the forwarded response
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
      );

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (err) {
      console.error(`Gateway error routing to ${serviceName}:`, err);
      return new Response(
        JSON.stringify({ error: "Service unavailable or connection refused" }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});

console.log(
  `🚀 Unified API Gateway listening on http://localhost:${GATEWAY_PORT}`,
);
console.log(
  `Routes traffic to 21 microservices based on the first URL segment (e.g. /auth/..., /billing/...)`,
);

function generateDashboardHTML(services: Record<string, number>) {
  const serviceRows = Object.entries(services)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, port]) => `
      <div class="service-card" id="service-${name}">
        <div class="service-info">
          <div class="service-name">${name}</div>
          <div class="service-port">Port: ${port}</div>
          <div class="service-url"><a href="/${name}/health" target="_blank">/${name}</a></div>
        </div>
        <div class="service-status">
          <span class="status-indicator status-unknown" data-service="${name}" data-port="${port}"></span>
          <span class="status-text">Checking...</span>
        </div>
      </div>
    `,
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Microservices Dashboard</title>
    <style>
        :root {
            --bg: #0f172a;
            --card-bg: #1e293b;
            --text: #f1f5f9;
            --text-dim: #94a3b8;
            --primary: #38bdf8;
            --success: #22c55e;
            --error: #ef4444;
            --warning: #f59e0b;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 2rem;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .container {
            width: 100%;
            max-width: 1000px;
        }
        header {
            margin-bottom: 2rem;
            text-align: center;
        }
        h1 {
            margin: 0;
            color: var(--primary);
            font-size: 2rem;
        }
        .subtitle {
            color: var(--text-dim);
            margin-top: 0.5rem;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1rem;
        }
        .service-card {
            background-color: var(--card-bg);
            border-radius: 0.75rem;
            padding: 1.25rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border: 1px solid #334155;
            transition: transform 0.1s;
        }
        .service-card:hover {
            transform: translateY(-2px);
            border-color: #475569;
        }
        .service-name {
            font-weight: bold;
            font-size: 1.1rem;
            text-transform: capitalize;
        }
        .service-port {
            font-size: 0.875rem;
            color: var(--text-dim);
            margin-top: 0.25rem;
        }
        .service-url a {
            color: var(--primary);
            text-decoration: none;
            font-size: 0.875rem;
        }
        .service-url a:hover {
            text-decoration: underline;
        }
        .service-status {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 0.5rem;
        }
        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }
        .status-text {
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
        }
        .status-up { background-color: var(--success); box-shadow: 0 0 8px var(--success); }
        .status-down { background-color: var(--error); box-shadow: 0 0 8px var(--error); }
        .status-unknown { background-color: var(--text-dim); }
        
        .global-health {
            margin-bottom: 2rem;
            padding: 1rem;
            border-radius: 0.75rem;
            background-color: var(--card-bg);
            border: 1px solid #334155;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .refresh-btn {
            background-color: var(--primary);
            color: var(--bg);
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            font-weight: bold;
            cursor: pointer;
        }
        .refresh-btn:hover { opacity: 0.9; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>@hasna/microservices</h1>
            <p class="subtitle">Unified API Gateway & Service Dashboard</p>
        </header>

        <div class="global-health">
            <div>
                <strong>Global Health:</strong> <span id="global-status">Checking...</span>
            </div>
            <button class="refresh-btn" onclick="checkAll()">Refresh Status</button>
        </div>

        <div class="grid">
            ${serviceRows}
        </div>
    </div>

    <script>
        async function checkService(name, port) {
            const card = document.getElementById('service-' + name);
            const indicator = card.querySelector('.status-indicator');
            const text = card.querySelector('.status-text');
            
            try {
                const res = await fetch(\`/\${name}/health\`);
                if (res.ok) {
                    indicator.className = 'status-indicator status-up';
                    text.innerText = 'Online';
                    text.style.color = 'var(--success)';
                    return true;
                } else {
                    indicator.className = 'status-indicator status-down';
                    text.innerText = 'Error (' + res.status + ')';
                    text.style.color = 'var(--error)';
                    return false;
                }
            } catch (e) {
                indicator.className = 'status-indicator status-down';
                text.innerText = 'Offline';
                text.style.color = 'var(--error)';
                return false;
            }
        }

        async function checkAll() {
            const indicators = document.querySelectorAll('.status-indicator');
            const globalStatus = document.getElementById('global-status');
            globalStatus.innerText = 'Checking...';
            globalStatus.style.color = 'var(--text)';

            const results = await Promise.all(
                Array.from(indicators).map(el => checkService(el.dataset.service, el.dataset.port))
            );

            const upCount = results.filter(r => r).length;
            const total = results.length;

            if (upCount === total) {
                globalStatus.innerText = 'HEALTHY (' + upCount + '/' + total + ')';
                globalStatus.style.color = 'var(--success)';
            } else if (upCount > 0) {
                globalStatus.innerText = 'DEGRADED (' + upCount + '/' + total + ')';
                globalStatus.style.color = 'var(--warning)';
            } else {
                globalStatus.innerText = 'OFFLINE (0/' + total + ')';
                globalStatus.style.color = 'var(--error)';
            }
        }

        // Initial check
        checkAll();
        // Poll every 30s
        setInterval(checkAll, 30000);
    </script>
</body>
</html>
  `;
}
