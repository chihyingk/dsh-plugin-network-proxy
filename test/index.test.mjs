import { test } from "node:test";
import assert from "node:assert/strict";

import { Context } from "@deepseek-ai/cordis";
import * as plugin from "../lib/index.js";

test("the plugin mounts and disposes with an empty configuration", async () => {
  const ctx = new Context();
  const fiber = ctx.plugin(plugin, {
    httpProxy: "",
    httpsProxy: "",
    noProxy: "",
    testUrl: "https://example.com/",
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(fiber.state, 2, "the plugin fiber should be active");
  } finally {
    await fiber.dispose();
  }
});

test("the plugin exports the Loader-facing interface", () => {
  assert.equal(plugin.name, "network-proxy");
  assert.ok(Array.isArray(plugin.inject));
  assert.equal(typeof plugin.apply, "function");
  assert.equal(typeof plugin.Config, "function");
});
