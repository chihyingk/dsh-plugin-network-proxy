import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const BUNDLE_PATH = new URL("../lib/client.js", import.meta.url);

/**
 * Load the browser bundle with the module-loader facade it expects.
 *
 * @returns the registered entry and the factory's exports.
 */
function loadBundle() {
  let entry;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          entry = value;
        },
      },
    },
  };
  vm.runInNewContext(readFileSync(BUNDLE_PATH, "utf8"), sandbox, {
    filename: "dsh-plugin-network-proxy/client.js",
  });
  assert.ok(entry, "client bundle did not register a module");

  const stubs = {
    "react/jsx-runtime": { jsx: () => null, jsxs: () => null },
    "@deepseek-ai/dsh-client-ui-primitives": {
      SettingsForm: () => null,
      SettingsValueField: () => null,
      SettingsFormModel: class {
        constructor(scope, fields) {
          this.scope = scope;
          this.fields = fields;
        }
        bind() {
          return { getSnapshot: () => ({}), subscribe: () => () => {} };
        }
        shell() {
          return {
            available: true,
            writable: true,
            dirty: false,
            invalid: false,
            saving: false,
            failed: false,
          };
        }
        field() {
          return { text: "", overridden: false };
        }
        actions() {
          return { edit() {}, resetField() {}, save() {}, discard() {} };
        }
        dispose() {}
      },
      settingsTextField: (name) => ({ name }),
    },
  };
  const exported = entry.factory((name) => {
    if (!(name in stubs)) throw new Error(`unexpected require: ${name}`);
    return stubs[name];
  });
  return { entry, exported };
}

test("the client bundle registers the plugin module", () => {
  const { entry } = loadBundle();
  assert.equal(entry.id, "dsh-plugin-network-proxy");
  assert.equal(typeof entry.factory, "function");
});

test("the client bundle exports the page plugin interface", () => {
  const { exported } = loadBundle();
  assert.equal(exported.NS, "settings.networkProxy");
  assert.deepEqual(Array.from(exported.inject), ["slots", "locale", "configForms"]);
  assert.equal(typeof exported.apply, "function");
});

test("the client bundle orders the page and addresses the host namespace", () => {
  const source = readFileSync(BUNDLE_PATH, "utf8");
  assert.match(source, /id: "network-proxy"/);
  assert.match(source, /const SETTINGS_NS = "network-proxy"/);
  assert.match(source, /order: 50/);
});
