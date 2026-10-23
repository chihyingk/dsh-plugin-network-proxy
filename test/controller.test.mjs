import { test } from "node:test";
import assert from "node:assert/strict";

import { createProxyController } from "../lib/controller.js";
import {
  nonLoopbackIPv4,
  startForwardProxy,
  startTargetServer,
} from "./fixtures/forward-proxy.mjs";

const targetIp = nonLoopbackIPv4();
const skip = targetIp === undefined ? "no non-loopback IPv4 address available" : false;

test(
  "installs, reroutes, bypasses, rejects SOCKS, and restores the direct route",
  { skip },
  async () => {
    const proxyA = await startForwardProxy();
    const proxyB = await startForwardProxy();
    const target = await startTargetServer();
    const targetUrl = `http://${targetIp}:${target.port}/`;
    let config = {
      httpProxy: proxyA.url,
      httpsProxy: "",
      noProxy: "",
      testUrl: targetUrl,
    };
    const controller = createProxyController({ readConfig: () => config });
    try {
      await controller.start();
      assert.equal(controller.status().phase, "active");

      const first = await controller.test(targetUrl);
      assert.equal(first.route.proxied, true);
      assert.equal(first.status, 200);
      assert.equal(proxyA.requestCount, 1);
      assert.match(proxyA.observations[0].url, /^http:\/\//);

      config = { ...config, httpProxy: proxyB.url };
      await controller.reload();
      const second = await controller.test(targetUrl);
      assert.equal(second.route.proxied, true);
      assert.equal(second.status, 200);
      assert.equal(proxyA.requestCount, 1);
      assert.equal(proxyB.requestCount, 1);

      config = { ...config, noProxy: targetIp };
      await controller.reload();
      const bypassed = await controller.test(targetUrl);
      assert.equal(bypassed.route.proxied, false);
      assert.equal(bypassed.status, 200);
      assert.equal(proxyB.requestCount, 1);

      config = {
        ...config,
        httpProxy: "socks5://127.0.0.1:1080",
        noProxy: "",
      };
      await controller.reload();
      const status = controller.status();
      assert.equal(status.phase, "active");
      assert.ok(
        status.diagnostics.some((message) => /SOCKS/i.test(message)),
        `expected a SOCKS diagnostic, got ${JSON.stringify(status.diagnostics)}`,
      );
      const direct = await controller.test(targetUrl);
      assert.equal(direct.route.proxied, false);
      assert.equal(direct.status, 200);

      config = { httpProxy: "", httpsProxy: "", noProxy: "", testUrl: targetUrl };
      await controller.reload();
      assert.equal(controller.status().phase, "idle");
      const idle = await controller.test(targetUrl);
      assert.equal(idle.route.proxied, false);
    } finally {
      await controller.stop();
      await proxyA.close();
      await proxyB.close();
      await target.close();
    }
  },
);

test("a rejected proxy URL never leaves a stale route installed", async () => {
  let config = {
    httpProxy: "not a url",
    httpsProxy: "",
    noProxy: "",
    testUrl: "http://example.com/",
  };
  const controller = createProxyController({ readConfig: () => config });
  try {
    await controller.start();
    const status = controller.status();
    assert.equal(status.phase, "active");
    assert.ok(status.diagnostics.length > 0);
    assert.equal(controller.routeFor("http://example.com/").proxied, false);

    config = { ...config, httpProxy: "", httpsProxy: "" };
    await controller.reload();
    assert.equal(controller.status().phase, "idle");
    assert.equal(controller.routeFor("http://example.com/").proxied, false);
  } finally {
    await controller.stop();
  }
});
