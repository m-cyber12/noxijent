import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["NOXIJENT_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["NOXIJENT_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("NOXIJENT_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  NOXIJENT_AUTO_HEAP_SNAPSHOT: truthy("NOXIJENT_AUTO_HEAP_SNAPSHOT"),
  NOXIJENT_GIT_BASH_PATH: process.env["NOXIJENT_GIT_BASH_PATH"],
  NOXIJENT_CONFIG: process.env["NOXIJENT_CONFIG"],
  NOXIJENT_CONFIG_CONTENT: process.env["NOXIJENT_CONFIG_CONTENT"],
  NOXIJENT_DISABLE_AUTOUPDATE: truthy("NOXIJENT_DISABLE_AUTOUPDATE"),
  NOXIJENT_ALWAYS_NOTIFY_UPDATE: truthy("NOXIJENT_ALWAYS_NOTIFY_UPDATE"),
  NOXIJENT_DISABLE_PRUNE: truthy("NOXIJENT_DISABLE_PRUNE"),
  NOXIJENT_DISABLE_TERMINAL_TITLE: truthy("NOXIJENT_DISABLE_TERMINAL_TITLE"),
  NOXIJENT_SHOW_TTFD: truthy("NOXIJENT_SHOW_TTFD"),
  NOXIJENT_DISABLE_AUTOCOMPACT: truthy("NOXIJENT_DISABLE_AUTOCOMPACT"),
  NOXIJENT_DISABLE_MODELS_FETCH: truthy("NOXIJENT_DISABLE_MODELS_FETCH"),
  NOXIJENT_DISABLE_MOUSE: truthy("NOXIJENT_DISABLE_MOUSE"),
  NOXIJENT_FAKE_VCS: process.env["NOXIJENT_FAKE_VCS"],
  NOXIJENT_SERVER_PASSWORD: process.env["NOXIJENT_SERVER_PASSWORD"],
  NOXIJENT_SERVER_USERNAME: process.env["NOXIJENT_SERVER_USERNAME"],
  NOXIJENT_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("NOXIJENT_DISABLE_FFF"),

  // Experimental
  NOXIJENT_EXPERIMENTAL_FILEWATCHER: Config.boolean("NOXIJENT_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  NOXIJENT_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("NOXIJENT_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  NOXIJENT_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("NOXIJENT_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  NOXIJENT_MODELS_URL: process.env["NOXIJENT_MODELS_URL"],
  NOXIJENT_MODELS_PATH: process.env["NOXIJENT_MODELS_PATH"],
  NOXIJENT_DB: process.env["NOXIJENT_DB"],

  NOXIJENT_WORKSPACE_ID: process.env["NOXIJENT_WORKSPACE_ID"],
  NOXIJENT_EXPERIMENTAL_WORKSPACES: enabledByExperimental("NOXIJENT_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get NOXIJENT_DISABLE_PROJECT_CONFIG() {
    return truthy("NOXIJENT_DISABLE_PROJECT_CONFIG")
  },
  get NOXIJENT_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("NOXIJENT_EXPERIMENTAL_REFERENCES")
  },
  get NOXIJENT_TUI_CONFIG() {
    return process.env["NOXIJENT_TUI_CONFIG"]
  },
  get NOXIJENT_CONFIG_DIR() {
    return process.env["NOXIJENT_CONFIG_DIR"]
  },
  get NOXIJENT_PURE() {
    return truthy("NOXIJENT_PURE")
  },
  get NOXIJENT_PERMISSION() {
    return process.env["NOXIJENT_PERMISSION"]
  },
  get NOXIJENT_PLUGIN_META_FILE() {
    return process.env["NOXIJENT_PLUGIN_META_FILE"]
  },
  get NOXIJENT_CLIENT() {
    return process.env["NOXIJENT_CLIENT"] ?? "cli"
  },
}
