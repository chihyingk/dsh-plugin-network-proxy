/**
 * Test fixtures: a minimal forward proxy and a target HTTP server.
 *
 * The proxy records both absolute-form HTTP requests and CONNECT tunnels so a
 * test can assert what the installed policy actually routed. The target listens
 * on every interface; tests address it through a non-loopback IPv4 address
 * because the proxy library always bypasses loopback destinations.
 */

import http from "node:http";
import net from "node:net";
import os from "node:os";

/**
 * Start a forward proxy on an ephemeral loopback port.
 *
 * @returns the proxy URL, observations, counters, and a close callback.
 */
export async function startForwardProxy() {
  const observations = [];
  const server = http.createServer((request, response) => {
    observations.push({
      kind: "request",
      method: request.method,
      url: request.url,
    });
    let target;
    try {
      target = new URL(request.url);
    } catch {
      response.writeHead(400);
      response.end("bad request");
      return;
    }
    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: request.method,
        headers: { ...request.headers, host: target.host },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", (error) => {
      if (!response.headersSent) response.writeHead(502);
      response.end(String(error));
    });
    request.pipe(upstream);
  });

  server.on("connect", (request, clientSocket, head) => {
    observations.push({ kind: "connect", url: request.url });
    const [host, port] = String(request.url ?? "").split(":");
    const upstream = net.connect(Number(port) || 443, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    observations,
    get requestCount() {
      return observations.filter((entry) => entry.kind === "request").length;
    },
    get connectCount() {
      return observations.filter((entry) => entry.kind === "connect").length;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Start an HTTP target server on every interface.
 *
 * @returns the port and a close callback.
 */
export async function startTargetServer() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const port = server.address().port;
  return {
    port,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Return one non-internal IPv4 address, or undefined when the host has none.
 *
 * A policy that always bypasses loopback would not route a 127.0.0.1 target
 * through the proxy, so integration tests need a routable local address.
 *
 * @returns the first non-loopback IPv4 address.
 */
export function nonLoopbackIPv4() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && entry.address !== "127.0.0.1") {
        return entry.address;
      }
    }
  }
  return undefined;
}
