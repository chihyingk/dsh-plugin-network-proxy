/**
 * `/proxy`: the human-facing command over the network-proxy controller.
 *
 * Commands run in the UI command plane, never in a model turn, so they remain
 * usable when a misconfigured proxy breaks model traffic. This module owns the
 * grammar, validation, persistence call, and the text the UI renders; the
 * controller owns whether the policy is installed.
 * @module dsh-plugin-network-proxy/command
 */

import {
  maskProxyUrl,
  sanitizeMessage,
  validateProxyUrl,
  validateTestUrl,
} from "./config.js";

/** One-line grammar hint used by discovery and error messages. */
export const PROXY_USAGE =
  "用法：/proxy | /proxy on <url> | /proxy off | /proxy http <url> | /proxy https <url> | /proxy no-proxy <list> | /proxy test [url]";

/**
 * Parse one `/proxy` argument string without normalizing its contents beyond
 * trimming the outer whitespace.
 *
 * @param input - the text following the command name.
 * @returns the parsed command or a usage error.
 */
export function parseProxyCommand(input) {
  const text = typeof input === "string" ? input.trim() : "";
  if (text.length === 0) return { kind: "status" };
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  const head = match[1].toLowerCase();
  const rest = (match[2] ?? "").trim();
  const missing = (name) => ({
    kind: "error",
    text: `/proxy ${name} 需要参数。\n${PROXY_USAGE}`,
  });
  switch (head) {
    case "on":
    case "set":
      return rest.length === 0 ? missing(head) : { kind: "set-both", value: rest };
    case "http":
      return rest.length === 0 ? missing(head) : { kind: "set-http", value: rest };
    case "https":
      return rest.length === 0 ? missing(head) : { kind: "set-https", value: rest };
    case "no-proxy":
    case "noproxy":
      return { kind: "set-bypass", value: rest };
    case "off":
      return rest.length === 0
        ? { kind: "off" }
        : { kind: "error", text: `/proxy off 不接受参数。\n${PROXY_USAGE}` };
    case "test":
      return { kind: "test", value: rest };
    default:
      return {
        kind: "error",
        text: `未知的 /proxy 子命令：${head}\n${PROXY_USAGE}`,
      };
  }
}

/**
 * Render the effective proxy configuration for a command result.
 *
 * @param config - the resolved configuration.
 * @returns plain text lines.
 */
export function formatProxyConfigSummary(config) {
  if (!config.enabled) {
    return "当前：插件不覆盖路由，进程沿用启动时环境变量（如有）或直连。";
  }
  return [
    `HTTP：${config.httpProxy.length > 0 ? maskProxyUrl(config.httpProxy) : "（不代理）"}`,
    `HTTPS：${
      config.httpsProxy.length > 0
        ? maskProxyUrl(config.httpsProxy)
        : config.httpProxy.length > 0
          ? "（沿用 HTTP 代理）"
          : "（不代理）"
    }`,
    `绕过：${config.noProxy.length > 0 ? config.noProxy : "（仅回环）"}`,
    `测试地址：${config.testUrl}`,
  ].join("\n");
}

/**
 * Render one connectivity test.
 *
 * @param result - the controller's probe result.
 * @param config - the configuration in force for the probe.
 * @returns plain text lines.
 */
export function formatProxyTest(result, config) {
  const lines = [
    `测试地址：${result.url}`,
    `路由：${result.route.proxied ? `经由 ${maskProxyUrl(result.route.proxy)}` : "直连（未经过代理）"}`,
    `结果：HTTP ${result.status}${result.statusText.length > 0 ? ` ${result.statusText}` : ""}，耗时 ${result.elapsedMs} ms`,
  ];
  if (!result.route.proxied && config.enabled) {
    lines.push("提示：该地址命中 no-proxy 或回环规则，因此没有经过代理。");
  }
  return lines.join("\n");
}

/**
 * Render `/proxy` status.
 *
 * @param status - the controller's current state.
 * @param controller - the controller, used to describe the test URL's route.
 * @returns plain text lines.
 */
export function formatProxyStatus(status, controller) {
  const config = status.config;
  const phase =
    status.phase === "active"
      ? "已生效"
      : status.phase === "applying"
        ? "正在应用"
        : status.phase === "error"
          ? "应用失败"
          : "未启用";
  const lines = [`网络代理：${config.enabled ? phase : "未启用（插件不覆盖路由）"}`];
  lines.push(formatProxyConfigSummary(config));
  try {
    const route = controller.routeFor(config.testUrl);
    lines.push(
      `测试地址路由：${route.proxied ? `经由 ${maskProxyUrl(route.proxy)}` : "直连"}`,
    );
  } catch {
    lines.push("测试地址路由：无法判断（测试地址无效）");
  }
  if (status.appliedAt !== undefined) {
    lines.push(`最近应用：${new Date(status.appliedAt).toLocaleString()}`);
  }
  if (status.error !== undefined) lines.push(`最近错误：${status.error}`);
  if (status.diagnostics.length > 0) {
    lines.push("诊断：");
    for (const message of status.diagnostics) lines.push(`- ${message}`);
  }
  lines.push("入口：Plugins → Built-in plugin settings → 网络代理");
  lines.push(`命令：${PROXY_USAGE}`);
  return lines.join("\n");
}

/**
 * Execute one `/proxy` invocation.
 *
 * @param invocation - the command invocation carrying `rawInput`.
 * @param deps - the controller and the persistence callback.
 * @param deps.controller - the network-proxy controller.
 * @param deps.persist - writes a patch to the plugin's profile entry.
 * @returns the command result for the UI command plane.
 */
export async function runProxyCommand(invocation, { controller, persist }) {
  const command = parseProxyCommand(invocation?.rawInput);
  if (command.kind === "error") return { kind: "error", text: command.text };
  try {
    if (command.kind === "status") {
      return { kind: "success", text: formatProxyStatus(controller.status(), controller) };
    }
    if (command.kind === "test") {
      const validated = validateTestUrl(command.value);
      if (validated.error !== undefined) return { kind: "error", text: validated.error };
      await controller.reload();
      try {
        const result = await controller.test(validated.url.href);
        return {
          kind: "success",
          text: formatProxyTest(result, controller.status().config),
        };
      } catch (error) {
        const config = controller.status().config;
        return {
          kind: "error",
          text: `代理测试失败：${sanitizeMessage(error?.message ?? String(error), config)}`,
        };
      }
    }

    let patch;
    let heading;
    switch (command.kind) {
      case "set-both": {
        const validated = validateProxyUrl(command.value);
        if (validated.error !== undefined) return { kind: "error", text: validated.error };
        patch = { httpProxy: validated.url.href, httpsProxy: validated.url.href };
        heading = "HTTP/HTTPS 代理已更新";
        break;
      }
      case "set-http": {
        const validated = validateProxyUrl(command.value);
        if (validated.error !== undefined) return { kind: "error", text: validated.error };
        patch = { httpProxy: validated.url.href };
        heading = "HTTP 代理已更新";
        break;
      }
      case "set-https": {
        const validated = validateProxyUrl(command.value);
        if (validated.error !== undefined) return { kind: "error", text: validated.error };
        patch = { httpsProxy: validated.url.href };
        heading = "HTTPS 代理已更新";
        break;
      }
      case "set-bypass":
        patch = { noProxy: command.value };
        heading = "绕过列表已更新";
        break;
      case "off":
        patch = { httpProxy: "", httpsProxy: "" };
        heading = "网络代理已关闭";
        break;
      default:
        return { kind: "error", text: PROXY_USAGE };
    }

    const saved = await persist(patch);
    await controller.reload();
    const config = controller.status().config;
    const lines = [heading];
    lines.push(saved.persisted ? "已保存到 profile 配置。" : `未持久化：${saved.reason}`);
    lines.push(formatProxyConfigSummary(config));

    if (command.kind === "set-both" || command.kind === "set-http" || command.kind === "set-https") {
      try {
        const result = await controller.test(config.testUrl);
        lines.push(formatProxyTest(result, config));
      } catch (error) {
        lines.push(`连通性测试失败：${sanitizeMessage(error?.message ?? String(error), config)}`);
        lines.push("代理可能未启动或不可达；修正后运行 /proxy test 重试，或运行 /proxy off 关闭。");
      }
    } else if (command.kind === "off") {
      try {
        const route = controller.routeFor(config.testUrl);
        if (route.proxied) {
          lines.push(
            `注意：启动环境仍配置了代理，测试地址将经由 ${maskProxyUrl(route.proxy)}。`,
          );
        }
      } catch {
        // The test URL is invalid; the configuration summary already says so.
      }
    }
    return { kind: "success", text: lines.join("\n") };
  } catch (error) {
    const config = controller.status().config;
    return {
      kind: "error",
      text: `/proxy 执行失败：${sanitizeMessage(error?.message ?? String(error), config)}`,
    };
  }
}
