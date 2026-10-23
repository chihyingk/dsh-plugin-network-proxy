import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatProxyStatus,
  formatProxyTest,
  parseProxyCommand,
  runProxyCommand,
} from "../lib/command.js";
import { DEFAULT_TEST_URL, readProxyConfig } from "../lib/config.js";

/**
 * Build a controller double whose configuration mirrors persisted patches.
 *
 * @param initial - the starting raw configuration.
 * @returns the fake controller and the recorded patches.
 */
function createHarness(initial = {}) {
  let raw = {
    httpProxy: "",
    httpsProxy: "",
    noProxy: "",
    testUrl: DEFAULT_TEST_URL,
    ...initial,
  };
  const patches = [];
  const calls = { reload: 0, test: [] };
  const controller = {
    calls,
    status() {
      const config = readProxyConfig(raw);
      return {
        phase: config.enabled ? "active" : "idle",
        config,
        diagnostics: [],
        error: undefined,
        appliedAt: 1,
      };
    },
    async reload() {
      calls.reload += 1;
    },
    routeFor() {
      const config = readProxyConfig(raw);
      return config.enabled
        ? { proxied: true, proxy: config.httpProxy || config.httpsProxy }
        : { proxied: false };
    },
    async test(url) {
      calls.test.push(url);
      const config = readProxyConfig(raw);
      return {
        url,
        route: config.enabled
          ? { proxied: true, proxy: config.httpProxy || config.httpsProxy }
          : { proxied: false },
        status: 204,
        statusText: "No Content",
        elapsedMs: 12,
      };
    },
  };
  const persist = async (patch) => {
    patches.push(patch);
    raw = { ...raw, ...patch };
    return { persisted: true };
  };
  return { controller, persist, patches, calls };
}

test("parseProxyCommand covers the grammar", () => {
  assert.deepEqual(parseProxyCommand(""), { kind: "status" });
  assert.deepEqual(parseProxyCommand("on http://127.0.0.1:7890"), {
    kind: "set-both",
    value: "http://127.0.0.1:7890",
  });
  assert.deepEqual(parseProxyCommand("http http://a"), { kind: "set-http", value: "http://a" });
  assert.deepEqual(parseProxyCommand("https https://b"), { kind: "set-https", value: "https://b" });
  assert.deepEqual(parseProxyCommand("no-proxy example.com,localhost"), {
    kind: "set-bypass",
    value: "example.com,localhost",
  });
  assert.deepEqual(parseProxyCommand("off"), { kind: "off" });
  assert.deepEqual(parseProxyCommand("test"), { kind: "test", value: "" });
  assert.equal(parseProxyCommand("on").kind, "error");
  assert.equal(parseProxyCommand("off extra").kind, "error");
  assert.equal(parseProxyCommand("wat").kind, "error");
});

test("/proxy on persists both fields, applies, and tests", async () => {
  const harness = createHarness();
  const result = await runProxyCommand(
    { rawInput: "on http://127.0.0.1:7890" },
    harness,
  );
  assert.equal(result.kind, "success");
  assert.deepEqual(harness.patches, [
    {
      httpProxy: "http://127.0.0.1:7890/",
      httpsProxy: "http://127.0.0.1:7890/",
    },
  ]);
  assert.equal(harness.calls.reload, 1);
  assert.deepEqual(harness.calls.test, [DEFAULT_TEST_URL]);
  assert.match(result.text, /已保存/);
  assert.match(result.text, /HTTP：http:\/\/127\.0\.0\.1:7890\//);
  assert.match(result.text, /HTTP 204/);
});

test("/proxy off clears both proxy fields", async () => {
  const harness = createHarness({
    httpProxy: "http://127.0.0.1:7890",
    httpsProxy: "http://127.0.0.1:7890",
  });
  const result = await runProxyCommand({ rawInput: "off" }, harness);
  assert.equal(result.kind, "success");
  assert.deepEqual(harness.patches, [{ httpProxy: "", httpsProxy: "" }]);
  assert.match(result.text, /已关闭/);
  assert.match(result.text, /不覆盖路由/);
});

test("/proxy http and /proxy https update one scheme", async () => {
  const first = createHarness();
  await runProxyCommand({ rawInput: "http http://127.0.0.1:7890" }, first);
  assert.deepEqual(first.patches, [{ httpProxy: "http://127.0.0.1:7890/" }]);

  const second = createHarness();
  await runProxyCommand({ rawInput: "https https://proxy.example:8443" }, second);
  assert.deepEqual(second.patches, [{ httpsProxy: "https://proxy.example:8443/" }]);
});

test("/proxy no-proxy writes the bypass list and accepts an empty clear", async () => {
  const first = createHarness();
  await runProxyCommand({ rawInput: "no-proxy example.com,localhost" }, first);
  assert.deepEqual(first.patches, [{ noProxy: "example.com,localhost" }]);

  const second = createHarness({ noProxy: "example.com" });
  const result = await runProxyCommand({ rawInput: "no-proxy" }, second);
  assert.equal(result.kind, "success");
  assert.deepEqual(second.patches, [{ noProxy: "" }]);
});

test("/proxy test renders the route and status", async () => {
  const harness = createHarness({ httpProxy: "http://127.0.0.1:7890" });
  const result = await runProxyCommand(
    { rawInput: "test https://example.com/" },
    harness,
  );
  assert.equal(result.kind, "success");
  assert.deepEqual(harness.calls.test, ["https://example.com/"]);
  assert.match(result.text, /测试地址：https:\/\/example\.com\//);
  assert.match(result.text, /经由 http:\/\/127\.0\.0\.1:7890/);
  assert.match(result.text, /HTTP 204/);
});

test("invalid URLs are refused before persistence", async () => {
  const harness = createHarness();
  const result = await runProxyCommand(
    { rawInput: "on socks5://127.0.0.1:1080" },
    harness,
  );
  assert.equal(result.kind, "error");
  assert.match(result.text, /只支持/);
  assert.deepEqual(harness.patches, []);
});

test("a failed profile write still reports the runtime result", async () => {
  const harness = createHarness();
  const persist = async () => ({ persisted: false, reason: "profile is read-only" });
  const result = await runProxyCommand(
    { rawInput: "on http://127.0.0.1:7890" },
    { ...harness, persist },
  );
  assert.equal(result.kind, "success");
  assert.match(result.text, /未持久化：profile is read-only/);
});

test("status masks credentials", () => {
  const harness = createHarness({
    httpProxy: "http://user:secret@127.0.0.1:7890",
  });
  const text = formatProxyStatus(harness.controller.status(), harness.controller);
  assert.equal(text.includes("secret"), false);
  assert.match(text, /\*\*\*:\*\*\*/);
  assert.match(text, /网络代理：已生效/);
});

test("formatProxyTest notes a bypass on an enabled configuration", () => {
  const text = formatProxyTest(
    { url: "https://example.com/", route: { proxied: false }, status: 200, statusText: "OK", elapsedMs: 5 },
    { enabled: true, httpProxy: "http://127.0.0.1:7890", httpsProxy: "", noProxy: "", testUrl: "" },
  );
  assert.match(text, /直连/);
  assert.match(text, /no-proxy 或回环/);
});
