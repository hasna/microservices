import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer as createNetServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  DEFAULT_MCP_HTTP_PORT,
  isHttpMode,
  resolveMcpHttpPort,
  startMcpHttpServer,
} from "./http.js";
import { buildServer } from "./index.js";

async function withBusyPort<T>(
  run: (port: number) => Promise<T> | T,
): Promise<T> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server to bind to a port");
  }

  try {
    return await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function childEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.MCP_HTTP;
  delete env.MCP_HTTP_PORT;
  delete env.MCP_STDIO;
  return { ...env, ...overrides };
}

describe("mcp http transport", () => {
  test("defaults port to 8868", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8868);
    expect(resolveMcpHttpPort(["node"], {})).toBe(8868);
    expect(resolveMcpHttpPort(["node", "--port", "9001"], {})).toBe(9001);
    expect(resolveMcpHttpPort(["node"], { MCP_HTTP_PORT: "9002" })).toBe(9002);
  });

  test("isHttpMode detects flag and env", () => {
    expect(isHttpMode(["node"], {})).toBe(false);
    expect(isHttpMode(["node", "--http"], {})).toBe(true);
    expect(isHttpMode(["node"], { MCP_HTTP: "1" })).toBe(true);
  });

  test("importing the module does not start the HTTP server", async () => {
    await withBusyPort(async (port) => {
      const result = Bun.spawnSync(
        ["bun", "-e", "await import('./src/mcp/index.ts')"],
        {
          cwd: process.cwd(),
          env: childEnv({ MCP_HTTP_PORT: String(port) }),
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe("");
      expect(result.stderr.toString()).toBe("");
    });
  });

  test("CLI exits non-zero when configured HTTP port is unavailable", async () => {
    await withBusyPort(async (port) => {
      const result = Bun.spawnSync(["bun", "run", "./src/mcp/index.ts"], {
        cwd: process.cwd(),
        env: childEnv({ MCP_HTTP_PORT: String(port) }),
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("EADDRINUSE");
    });
  });

  test("CLI help reports the configured default HTTP port", () => {
    const result = Bun.spawnSync(
      ["bun", "run", "./src/mcp/index.ts", "--help"],
      {
        cwd: process.cwd(),
        env: childEnv(),
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(
      `HTTP port (default: ${DEFAULT_MCP_HTTP_PORT}, env: MCP_HTTP_PORT)`,
    );
    expect(result.stderr.toString()).toBe("");
  });
});

describe("mcp buildServer stdio registration", () => {
  test("registers tools over in-memory transport", async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "list_microservices")).toBe(true);

    await client.close();
    await server.close();
  });
});

describe("mcp streamable http server", () => {
  let handle: Awaited<ReturnType<typeof startMcpHttpServer>>;

  beforeAll(async () => {
    handle = await startMcpHttpServer(buildServer, { port: 0 });
  });

  afterAll(async () => {
    await handle.close();
  });

  test("GET /health returns ok", async () => {
    const res = await fetch(`http://${handle.host}:${handle.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "microservices" });
  });

  test("initialize and call list_microservices over streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${handle.host}:${handle.port}/mcp`),
    );
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "list_microservices")).toBe(true);

    const result = await client.callTool({
      name: "list_microservices",
      arguments: {},
    });
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    await client.close();
  });

  test("serves three concurrent clients from one process", async () => {
    const clients = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://${handle.host}:${handle.port}/mcp`),
        );
        const client = new Client({ name: "test", version: "0.0.0" });
        await client.connect(transport);
        const tools = await client.listTools();
        return { client, count: tools.tools.length };
      }),
    );

    expect(clients.every((entry) => entry.count > 0)).toBe(true);
    await Promise.all(clients.map((entry) => entry.client.close()));
  });
});
