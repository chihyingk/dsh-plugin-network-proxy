/**
 * Configuration helpers for the network-proxy plugin: read the volatile
 * references the Loader hands to `apply`, validate proxy and test URLs, mask
 * credentials for output, and build the environment lookup that
 * `@deepseek-ai/dsh-http-proxy` resolves its policy from.
 *
 * Nothing here imports Cordis or a transport, so it stays testable on its own.
 * @module dsh-plugin-network-proxy/config
 */

/** Address `/proxy test` uses when the configuration names none. */
export const DEFAULT_TEST_URL = "https://www.google.com/generate_204";

/**
 * The bypass list shown by default. The proxy library always merges the
 * loopback entries itself; naming them here only makes the effective default
 * visible in the settings page.
 */
export const DEFAULT_NO_PROXY = "localhost,127.0.0.1,::1";

/**
 * Read one config field. The Loader passes volatile fields as reference
 * objects with `get()`; tests and plain Cordis compositions pass values.
 *
 * @param config - the plugin's config object.
 * @param name - the field name.
 * @returns the trimmed string value, or `""` when absent.
 */
function readField(config, name) {
  const value = config?.[name];
  const raw =
    value !== null && typeof value === "object" && typeof value.get === "function"
      ? value.get()
      : value;
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Read the plugin's proxy configuration from a Loader config or plain values.
 *
 * An absent or blank `testUrl` resolves to {@link DEFAULT_TEST_URL}; the proxy
 * fields stay empty so callers can tell "not configured" from "configured".
 *
 * @param config - the plugin's config object.
 * @returns the trimmed configuration plus whether any scheme is proxied.
 */
export function readProxyConfig(config) {
  const httpProxy = readField(config, "httpProxy");
  const httpsProxy = readField(config, "httpsProxy");
  const noProxy = readField(config, "noProxy");
  const testUrl = readField(config, "testUrl") || DEFAULT_TEST_URL;
  return {
    httpProxy,
    httpsProxy,
    noProxy,
    testUrl,
    enabled: httpProxy.length > 0 || httpsProxy.length > 0,
  };
}

/**
 * Validate a proxy URL: parseable, with an `http:` or `https:` scheme.
 *
 * SOCKS and PAC are rejected here rather than handed to the library, so the
 * command can refuse them before persisting a value it cannot route.
 *
 * @param value - the candidate proxy URL.
 * @returns the parsed URL, or a user-facing error.
 */
export function validateProxyUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) {
    return { error: "需要提供代理地址，例如 http://127.0.0.1:7890" };
  }
  if (!URL.canParse(text)) {
    return { error: `不是合法的 URL：${text}` };
  }
  const url = new URL(text);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: `只支持 http:// 或 https:// 代理，不支持 ${url.protocol}//` };
  }
  return { url };
}

/**
 * Validate the URL `/proxy test` should request.
 *
 * @param value - the candidate test URL, or an empty string for the default.
 * @returns the parsed URL, or a user-facing error.
 */
export function validateTestUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) return { url: new URL(DEFAULT_TEST_URL) };
  if (!URL.canParse(text)) return { error: `不是合法的 URL：${text}` };
  const url = new URL(text);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "测试地址必须是 http:// 或 https:// URL" };
  }
  return { url };
}

/**
 * Mask the username and password of a proxy URL for logs and command output.
 *
 * @param value - the proxy URL.
 * @returns the masked URL, an empty string, or a marker for an unparseable URL.
 */
export function maskProxyUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) return "";
  if (!URL.canParse(value)) return "<无法解析的代理地址>";
  const url = new URL(value);
  if (url.username.length > 0 || url.password.length > 0) {
    url.username = "***";
    url.password = "***";
  }
  return url.href;
}

/**
 * Build the `EnvLookup` shape `installProxyFromEnvironment` reads.
 *
 * Only the names this plugin configures are present. An empty `httpsProxy`
 * supplies no `https_proxy`, which is what makes the library fall back to the
 * HTTP proxy; an empty `noProxy` supplies no list, which leaves the library's
 * loopback bypass in place.
 *
 * @param config - the resolved proxy configuration.
 * @returns an environment lookup over the configured proxy names.
 */
export function proxyEnvLookup(config) {
  const values = {};
  if (config.httpProxy.length > 0) {
    values.http_proxy = config.httpProxy;
    values.HTTP_PROXY = config.httpProxy;
  }
  if (config.httpsProxy.length > 0) {
    values.https_proxy = config.httpsProxy;
    values.HTTPS_PROXY = config.httpsProxy;
  }
  if (config.noProxy.length > 0) {
    values.no_proxy = config.noProxy;
    values.NO_PROXY = config.noProxy;
  }
  return {
    get(name) {
      const value = values[name];
      return value === undefined ? undefined : { value };
    },
  };
}

/**
 * Replace every configured proxy URL in a message with its masked form.
 *
 * Transport errors occasionally echo a destination address; a proxy URL can
 * carry credentials, so no output path may repeat it verbatim.
 *
 * @param message - the raw message or error.
 * @param config - the resolved proxy configuration.
 * @returns the message with configured proxy URLs masked.
 */
export function sanitizeMessage(message, config) {
  let text = typeof message === "string" ? message : String(message);
  for (const value of [config?.httpProxy ?? "", config?.httpsProxy ?? ""]) {
    if (value.length > 0) text = text.split(value).join(maskProxyUrl(value));
  }
  return text;
}
