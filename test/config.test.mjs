import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TEST_URL,
  maskProxyUrl,
  proxyEnvLookup,
  readProxyConfig,
  sanitizeMessage,
  validateProxyUrl,
  validateTestUrl,
} from "../lib/config.js";

const ref = (value) => ({ get: () => value });

test("readProxyConfig reads volatile references and plain values", () => {
  assert.deepEqual(
    readProxyConfig({
      httpProxy: ref(" http://127.0.0.1:7890 "),
      httpsProxy: ref(""),
      noProxy: ref(" example.com "),
      testUrl: ref(""),
    }),
    {
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "",
      noProxy: "example.com",
      testUrl: DEFAULT_TEST_URL,
      enabled: true,
    },
  );
  assert.deepEqual(
    readProxyConfig({ httpProxy: "", httpsProxy: "", noProxy: "", testUrl: "https://example.com/" }),
    {
      httpProxy: "",
      httpsProxy: "",
      noProxy: "",
      testUrl: "https://example.com/",
      enabled: false,
    },
  );
});

test("validateProxyUrl accepts only http(s) proxy URLs", () => {
  assert.ok(validateProxyUrl("http://127.0.0.1:7890").url);
  assert.ok(validateProxyUrl("https://proxy.example:8443").url);
  assert.match(validateProxyUrl("").error, /代理地址/);
  assert.match(validateProxyUrl("127.0.0.1:7890").error, /不是合法的 URL/);
  assert.match(validateProxyUrl("socks5://127.0.0.1:1080").error, /只支持/);
});

test("validateTestUrl defaults and validates", () => {
  assert.equal(validateTestUrl("").url.href, DEFAULT_TEST_URL);
  assert.equal(validateTestUrl("https://example.com/x").url.href, "https://example.com/x");
  assert.match(validateTestUrl("not a url").error, /不是合法的 URL/);
  assert.match(validateTestUrl("ftp://example.com").error, /http/);
});

test("maskProxyUrl hides credentials and marks unparseable values", () => {
  assert.equal(maskProxyUrl(""), "");
  assert.equal(maskProxyUrl("<bad>"), "<无法解析的代理地址>");
  const masked = maskProxyUrl("http://user:secret@127.0.0.1:7890");
  assert.equal(masked, "http://***:***@127.0.0.1:7890/");
  assert.equal(masked.includes("secret"), false);
});

test("proxyEnvLookup supplies only configured names", () => {
  const lookup = proxyEnvLookup({
    httpProxy: "http://127.0.0.1:7890",
    httpsProxy: "",
    noProxy: "example.com",
    testUrl: "",
  });
  assert.deepEqual(lookup.get("http_proxy"), { value: "http://127.0.0.1:7890" });
  assert.deepEqual(lookup.get("HTTP_PROXY"), { value: "http://127.0.0.1:7890" });
  assert.equal(lookup.get("https_proxy"), undefined);
  assert.equal(lookup.get("HTTPS_PROXY"), undefined);
  assert.deepEqual(lookup.get("no_proxy"), { value: "example.com" });
  assert.equal(lookup.get("all_proxy"), undefined);
});

test("sanitizeMessage replaces configured proxy URLs", () => {
  const config = {
    httpProxy: "http://user:secret@127.0.0.1:7890",
    httpsProxy: "",
    noProxy: "",
    testUrl: "",
  };
  const message = sanitizeMessage(
    "failed to connect to http://user:secret@127.0.0.1:7890",
    config,
  );
  assert.equal(message.includes("secret"), false);
  assert.match(message, /http:\/\/\*\*\*:\*\*\*@127\.0\.0\.1:7890\//);
});
