/**
 * The network-proxy controller: turn one resolved configuration into an
 * installed outbound proxy policy, replace it on every change, and restore the
 * launcher's policy on disposal.
 *
 * The transport work belongs to `@deepseek-ai/dsh-http-proxy`, whose public
 * `installProxyFromEnvironment` installs undici's global dispatcher and
 * publishes the proxy environment. This module owns only the lifecycle: one
 * serial reconciliation queue, idle/active/error state, and the connectivity
 * probe the command reports.
 * @module dsh-plugin-network-proxy/controller
 */

import {
  installProxyFromEnvironment,
  proxyRouteFor,
} from "@deepseek-ai/dsh-http-proxy";
import { proxyEnvLookup, readProxyConfig, sanitizeMessage } from "./config.js";

/** Deadline for one `/proxy test` request. */
const TEST_TIMEOUT_MS = 15_000;

/** Number of rejected proxy values kept for the status report. */
const MAX_DIAGNOSTICS = 5;

/**
 * Create the proxy controller.
 *
 * @param options - the configuration reader, install function, and logger.
 * @param options.readConfig - returns the current Loader config (or plain values).
 * @param options.install - installs a policy; injectable for tests.
 * @param options.logger - a Cordis logger facade; optional in tests.
 * @returns the lifecycle, status, and probe interface.
 */
export function createProxyController({
  readConfig,
  install = installProxyFromEnvironment,
  logger,
}) {
  /** No-op logger so the controller works without a Cordis context. */
  const log = logger ?? {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };

  let disposed = false;
  let queue = Promise.resolve();
  let currentDispose;
  let appliedKey;
  let state = {
    phase: "idle",
    config: readProxyConfig(readConfig()),
    diagnostics: [],
    error: undefined,
    appliedAt: undefined,
  };

  /** A detached copy of the current state. */
  function snapshot() {
    return {
      ...state,
      config: { ...state.config },
      diagnostics: [...state.diagnostics],
    };
  }

  /** Restore whatever policy was installed before this controller's own. */
  async function disposeCurrent() {
    if (currentDispose === undefined) return;
    const dispose = currentDispose;
    currentDispose = undefined;
    appliedKey = undefined;
    try {
      await dispose();
    } catch (error) {
      log.warn(
        "network-proxy: restoring the previous proxy policy failed: %s",
        error?.message ?? String(error),
      );
    }
  }

  /** Apply the configuration read right now, or restore the launch policy. */
  async function reconcile() {
    if (disposed) return;
    const config = readProxyConfig(readConfig());
    const key = JSON.stringify(config);
    if (key === appliedKey && state.phase !== "error") {
      state = { ...state, config };
      return;
    }
    await disposeCurrent();
    if (disposed) return;
    if (!config.enabled) {
      appliedKey = key;
      state = {
        phase: "idle",
        config,
        diagnostics: [],
        error: undefined,
        appliedAt: Date.now(),
      };
      return;
    }
    const diagnostics = [];
    state = { ...state, phase: "applying", config, diagnostics: [], error: undefined };
    try {
      const dispose = await install(proxyEnvLookup(config), (message) => {
        diagnostics.push(message);
      });
      if (disposed) {
        await dispose();
        return;
      }
      currentDispose = dispose;
      appliedKey = key;
      state = {
        phase: "active",
        config,
        diagnostics: diagnostics.slice(-MAX_DIAGNOSTICS),
        error: undefined,
        appliedAt: Date.now(),
      };
      for (const message of diagnostics) {
        log.warn("network-proxy: %s", sanitizeMessage(message, config));
      }
    } catch (error) {
      appliedKey = undefined;
      const message = sanitizeMessage(error?.message ?? String(error), config);
      state = {
        phase: "error",
        config,
        diagnostics: diagnostics.slice(-MAX_DIAGNOSTICS),
        error: message,
        appliedAt: state.appliedAt,
      };
      log.error("network-proxy: installing the outbound proxy failed: %s", message);
    }
  }

  /** Queue one reconciliation behind every earlier one. */
  function enqueue() {
    queue = queue.then(reconcile, reconcile).catch((error) => {
      log.error(
        "network-proxy: proxy reconciliation failed: %s",
        error?.message ?? String(error),
      );
    });
    return queue;
  }

  return {
    /** Install the initial policy; resolves after it settles. */
    start() {
      return enqueue();
    },
    /** Re-read the configuration and apply it; resolves after it settles. */
    reload() {
      return enqueue();
    },
    /** Resolve when every queued reconciliation has settled. */
    settled() {
      return queue;
    },
    /** Restore the launcher's policy and stop accepting changes. */
    async stop() {
      disposed = true;
      await queue.catch(() => {});
      await disposeCurrent();
      state = { ...state, phase: "idle" };
    },
    /** The current lifecycle state and configuration. */
    status() {
      return snapshot();
    },
    /** The route one URL would take under the policy installed right now. */
    routeFor(url) {
      return proxyRouteFor(new URL(url));
    },
    /**
     * Request one URL through the policy installed right now.
     *
     * @param url - the target URL.
     * @returns the route, response status, and elapsed time.
     */
    async test(url) {
      const target = new URL(url);
      const route = proxyRouteFor(target);
      const started = performance.now();
      const response = await fetch(target, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      const elapsedMs = Math.round(performance.now() - started);
      await response.body?.cancel();
      return {
        url: target.href,
        route,
        status: response.status,
        statusText: response.statusText,
        elapsedMs,
      };
    },
  };
}
