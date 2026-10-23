window.__ModuleLoader__.load({
  id: "dsh-plugin-network-proxy",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react_jsx_runtime = require("react/jsx-runtime");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    //#region locales
    /** Simplified Chinese copy for the network-proxy settings page. */
    const zh = {
      title: "网络代理",
      description:
        "配置 DSH 的出站 HTTP(S) 代理；保存后立即作用于模型、搜索、抓取和 MCP 请求。",
      httpProxy: "HTTP 代理",
      httpProxyHint:
        "例如 http://127.0.0.1:7890。留空表示不使用代理；与 HTTPS 同时留空即关闭插件代理。",
      httpsProxy: "HTTPS 代理",
      httpsProxyHint: "留空时沿用 HTTP 代理。",
      noProxy: "绕过列表",
      noProxyHint:
        "逗号分隔的主机名或主机:端口，子域自动匹配；不支持 CIDR。localhost 和回环地址始终直连。",
      testUrl: "测试地址",
      testUrlHint:
        "供 /proxy test 使用；留空使用默认地址。保存后可在聊天中运行 /proxy test 验证。",
      overridden: "已覆盖",
      reset: "恢复默认",
      readOnly: "本部署的设置为只读。",
      unavailable: "该插件当前未加载，暂时无法配置。",
      save: "保存",
      saving: "保存中…",
      saveFailed: "本部署没有接受这些值，已保留供你修改。",
      invalidUrl: "请输入 http:// 或 https:// 地址，或留空。",
    };

    /** English copy for the network-proxy settings page. */
    const en = {
      title: "Network proxy",
      description:
        "Route DSH outbound HTTP(S) traffic through a proxy. Saves apply immediately to models, search, fetch, and MCP requests.",
      httpProxy: "HTTP proxy",
      httpProxyHint:
        "For example http://127.0.0.1:7890. Leave both proxy fields blank to turn the plugin's proxy off.",
      httpsProxy: "HTTPS proxy",
      httpsProxyHint: "Leave blank to reuse the HTTP proxy.",
      noProxy: "Bypass list",
      noProxyHint:
        "Comma-separated hosts or host:port entries; subdomains match. CIDR is not supported. Loopback is always direct.",
      testUrl: "Test URL",
      testUrlHint:
        "Used by /proxy test; leave blank for the default. Run /proxy test in chat after saving.",
      overridden: "Overridden",
      reset: "Reset to default",
      readOnly: "This deployment stores settings read-only.",
      unavailable: "This plugin is not loaded, so it cannot be configured right now.",
      save: "Save",
      saving: "Saving…",
      saveFailed: "The deployment did not accept these values; they were left for you to correct.",
      invalidUrl: "Enter an http:// or https:// URL, or leave it blank.",
    };

    /**
     * The form frame's copy, read from this page's dictionary.
     * @param t - the page's locale reader.
     * @returns the labels the shared settings form renders.
     */
    function formLabels(t) {
      return {
        unavailable: t("unavailable"),
        readOnly: t("readOnly"),
        saveFailed: t("saveFailed"),
        save: t("save"),
        saving: t("saving"),
      };
    }
    //#endregion

    //#region settings fields
    /**
     * A URL text field: empty clears the value, an http(s) URL stages its
     * normalized form, and anything else marks the form invalid.
     * @param name - the schema field name.
     * @returns the field descriptor.
     */
    function urlTextField(name) {
      return {
        ...primitives.settingsTextField(name),
        parse: (text) => {
          const value = text.trim();
          if (value.length === 0) return { kind: "clear" };
          let url;
          try {
            url = new URL(value);
          } catch {
            return undefined;
          }
          if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
          return { kind: "set", value: url.href };
        },
      };
    }

    /**
     * A free text field: empty clears the value.
     * @param name - the schema field name.
     * @returns the field descriptor.
     */
    function textField(name) {
      return {
        ...primitives.settingsTextField(name),
        parse: (text) => {
          const value = text.trim();
          return value.length === 0 ? { kind: "clear" } : { kind: "set", value };
        },
      };
    }
    //#endregion

    //#region card
    /**
     * Render the network-proxy one-liner or its settings form.
     * @param props - the view asked for, locale copy, the form snapshot, and its actions.
     * @returns the one-liner, or the form.
     */
    function NetworkProxyCard(props) {
      const { t } = props;
      const state = props.useNetworkProxyCard((snapshot) => snapshot);
      if (props.view === "summary") return t("description");
      const disabled = !state.writable || state.saving;
      const field = (name) => ({
        id: `plugin-config-network-proxy-${name}`,
        disabled,
        overriddenLabel: t("overridden"),
        resetLabel: t("reset"),
        invalidLabel: t("invalidUrl"),
        ...state[name],
        onEdit: (text) => {
          props.edit(name, text);
        },
        onReset: () => {
          props.resetField(name);
        },
      });
      return (0, react_jsx_runtime.jsxs)(primitives.SettingsForm, {
        labels: formLabels(t),
        state,
        onSave: props.save,
        onDiscard: props.discard,
        children: [
          (0, react_jsx_runtime.jsx)(primitives.SettingsValueField, {
            ...field("httpProxy"),
            label: t("httpProxy"),
            hint: t("httpProxyHint"),
          }),
          (0, react_jsx_runtime.jsx)(primitives.SettingsValueField, {
            ...field("httpsProxy"),
            label: t("httpsProxy"),
            hint: t("httpsProxyHint"),
          }),
          (0, react_jsx_runtime.jsx)(primitives.SettingsValueField, {
            ...field("noProxy"),
            label: t("noProxy"),
            hint: t("noProxyHint"),
          }),
          (0, react_jsx_runtime.jsx)(primitives.SettingsValueField, {
            ...field("testUrl"),
            label: t("testUrl"),
            hint: t("testUrlHint"),
          }),
        ],
      });
    }

    /** Namespace of the plugin's settings form; must match the profile row id. */
    const SETTINGS_NS = "network-proxy";

    /** Bridges the `network-proxy` settings scope onto the page's staged form. */
    var NetworkProxyCardController = class {
      form;
      store;

      /** @param scope - the bound settings scope for the `network-proxy` namespace. */
      constructor(scope) {
        this.form = new primitives.SettingsFormModel(scope, [
          urlTextField("httpProxy"),
          urlTextField("httpsProxy"),
          textField("noProxy"),
          urlTextField("testUrl"),
        ]);
        this.store = this.form.bind(() => this.projection());
      }

      projection() {
        return {
          ...this.form.shell(),
          httpProxy: this.form.field("httpProxy"),
          httpsProxy: this.form.field("httpsProxy"),
          noProxy: this.form.field("noProxy"),
          testUrl: this.form.field("testUrl"),
        };
      }

      /**
       * Build the face the page's slot registration injects.
       * @returns the page's snapshot and its form actions.
       */
      inject() {
        return {
          hooks: { networkProxyCard: this.store },
          ...this.form.actions(),
        };
      }

      /** Release accepted-value subscriptions. */
      dispose() {
        this.form.dispose();
      }
    };
    //#endregion

    //#region plugin
    /** Dictionary namespace owned by this plugin. */
    const NS = "settings.networkProxy";

    /** Required services (cordis fiber inject). */
    const inject = ["slots", "locale", "configForms"];

    /**
     * Mount the network-proxy settings page while the Host serves its namespace.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        "network-proxy: dictionaries",
      );
      const card = new NetworkProxyCardController(ctx.configForms.get(SETTINGS_NS));
      ctx.effect(
        () => () => {
          card.dispose();
        },
        "network-proxy: form subscription",
      );
      ctx.effect(
        () =>
          ctx.configForms.whileServed([SETTINGS_NS], () =>
            ctx.slots.inject("plugins.item", () =>
              ctx.slots.register(
                {
                  name: "plugins.item",
                  id: "network-proxy",
                  order: 50,
                  label: () => t("title"),
                  locale: NS,
                  inject: () => card.inject(),
                },
                NetworkProxyCard,
              ),
            ),
          ),
        "network-proxy: settings page",
      );
    }
    //#endregion

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
