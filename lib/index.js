/**
 * Cordis entry for the network-proxy plugin.
 *
 * The plugin mounts one outbound proxy policy from its volatile configuration,
 * re-applies it whenever Settings or `/proxy` changes a field, and restores the
 * launcher's policy on disposal. The Web settings page lives in `client.js`.
 * @module dsh-plugin-network-proxy
 */

import z from "@deepseek-ai/schemastery";
import { DEFAULT_NO_PROXY, DEFAULT_TEST_URL, readProxyConfig, sanitizeMessage } from "./config.js";
import { createProxyController } from "./controller.js";
import { runProxyCommand } from "./command.js";

/** Loader-facing plugin name. */
export const name = "network-proxy";

/** No required services: the command and Settings integration are optional children. */
export const inject = [];

/**
 * Volatile fields are editable through the settings page without remounting
 * this plugin; the Loader emits `loader/volatile-update` after every write.
 */
export const Config = z.object({
  httpProxy: z
    .string()
    .default("")
    .description("HTTP proxy URL (http:// or https://); empty disables proxying for http:")
    .volatile(),
  httpsProxy: z
    .string()
    .default("")
    .description("HTTPS proxy URL; empty falls back to httpProxy")
    .volatile(),
  noProxy: z
    .string()
    .default(DEFAULT_NO_PROXY)
    .description("Comma-separated bypass list; loopback is always bypassed")
    .volatile(),
  testUrl: z
    .string()
    .default(DEFAULT_TEST_URL)
    .description("Default URL used by /proxy test")
    .volatile(),
});

/**
 * Mount the outbound proxy controller, the `/proxy` command, and the settings
 * page policy for this plugin instance.
 *
 * @param ctx - the plugin's Cordis context.
 * @param config - the validated volatile configuration.
 */
export function apply(ctx, config) {
  const logger = ctx.logger("network-proxy");
  const controller = createProxyController({ readConfig: () => config, logger });
  const entryId = ctx.fiber.entry?.options.id;

  /**
   * Persist a volatile configuration patch into this profile entry.
   *
   * @param patch - the fields to merge.
   * @returns whether the write reached the profile, and why it did not.
   */
  async function persist(patch) {
    if (entryId === undefined) {
      return {
        persisted: false,
        reason: "当前插件没有 profile 条目 id，配置只在此进程生效",
      };
    }
    const settings = ctx.get("settings");
    if (settings === undefined) {
      return {
        persisted: false,
        reason: "Settings 服务不可用，配置只在此进程生效",
      };
    }
    try {
      await settings.update(entryId, patch);
      return { persisted: true };
    } catch (error) {
      return {
        persisted: false,
        reason: sanitizeMessage(
          error?.message ?? String(error),
          readProxyConfig(config),
        ),
      };
    }
  }

  ctx.effect(async () => {
    await controller.start();
    return () => controller.stop();
  }, "network-proxy: outbound proxy");

  ctx.on("loader/volatile-update", () => {
    void controller.reload();
  });

  // This plugin ships its own settings page; a client must not generate one.
  ctx.inject(["settings"], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });

  ctx.inject(["commands"], (child) => {
    child.effect(() => {
      const dispose = child.commands.register({
        name: "proxy",
        description: "查看或修改 DSH 的出站 HTTP(S) 代理",
        input: {
          hint: "[on <url>|off|http <url>|https <url>|no-proxy <list>|test [url]]",
        },
        handler: (invocation) => runProxyCommand(invocation, { controller, persist }),
      });
      return () => dispose();
    });
  });
}
