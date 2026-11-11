const path = require("node:path");
const fs = require("node:fs");
const { HOME, roots, files } = require("./io");
const h = (...parts) => path.join(HOME, ...parts);
const config = process.env.XDG_CONFIG_HOME || h(".config");
const data = process.env.XDG_DATA_HOME || h(".local", "share");
const roaming = process.env.APPDATA || h("AppData", "Roaming");
const local = process.env.LOCALAPPDATA || h("AppData", "Local");
const definitions = {
  claude: ["Claude", "CLAUDE_CONFIG_DIR", [h(".claude"), path.join(config, "claude")]],
  codex: ["Codex", "CODEX_HOME", [h(".codex")]],
  opencode: [
    "OpenCode",
    "OPENCODE_DATA_DIR",
    [
      path.join(data, "opencode"),
      h(".local", "share", "opencode"),
      path.join(roaming, "opencode"),
      path.join(local, "opencode"),
      h("Library", "Application Support", "opencode"),
      h(".opencode")
    ]
  ],
  kilo: ["Kilo Code", "KILO_DATA_DIR", [path.join(data, "kilo")]],
  goose: [
    "Goose",
    "GOOSE_PATH_ROOT",
    [path.join(data, "goose"), path.join(data, "Block", "goose"), h("Library", "Application Support", "goose")]
  ],
  hermes: ["Hermes", "HERMES_HOME", [h(".hermes")]],
  gemini: ["Gemini", "GEMINI_DATA_DIR", [h(".gemini", "tmp")]],
  qwen: ["Qwen", "QWEN_DATA_DIR", [h(".qwen")]],
  droid: ["Droid", "DROID_SESSIONS_DIR", [h(".factory", "sessions")]],
  amp: ["Amp", "AMP_DATA_DIR", [path.join(data, "amp")]],
  kimi: ["Kimi", "KIMI_DATA_DIR", [h(".kimi"), h(".kimi-code")]],
  codebuff: [
    "Codebuff",
    "CODEBUFF_DATA_DIR",
    ["manicode", "manicode-dev", "manicode-staging"].map((n) => path.join(config, n))
  ],
  openclaw: ["OpenClaw", "OPENCLAW_DIR", [".openclaw", ".clawdbot", ".moltbot", ".moldbot"].map((n) => h(n))],
  pi: ["Pi", "PI_AGENT_DIR", [h(".pi", "agent", "sessions")]],
  copilot: ["GitHub Copilot", "COPILOT_OTEL_FILE_EXPORTER_PATH", [h(".copilot", "otel")]],
  cursor: [
    "Cursor",
    "CURSOR_DATA_DIR",
    [
      path.join(roaming, "Cursor", "User"),
      path.join(config, "Cursor", "User"),
      h("Library", "Application Support", "Cursor", "User")
    ]
  ],
  antigravity: ["Antigravity", "ANTIGRAVITY_DATA_DIR", [h(".gemini", "antigravity-cli"), h(".gemini", "antigravity")]],
  grok: [
    "Grok",
    "GROK_HOME",
    [
      h(".grok"),
      path.join(config, "grok"),
      path.join(roaming, "Grok"),
      path.join(local, "Grok"),
      h("Library", "Application Support", "Grok")
    ]
  ],
  muse: ["Muse Code", "MUSE_HOME", []]
};
function sourceRoots(id) {
  const [, variable, defaults] = definitions[id];
  let result = roots(variable, defaults);
  if (id === "claude") result = result.map((p) => (path.basename(p) === "projects" ? path.dirname(p) : p));
  if (id === "pi" && process.env.PI_CODING_AGENT_SESSION_DIR) result = roots("PI_CODING_AGENT_SESSION_DIR", []);
  else if (id === "pi" && process.env.PI_CODING_AGENT_DIR)
    result = roots("PI_CODING_AGENT_DIR", []).map((p) => path.join(p, "sessions"));
  return [...new Set(result)];
}
function sourceFiles(id, suffix = ".jsonl") {
  const result = [];
  for (const root of sourceRoots(id)) {
    try {
      if (fs.statSync(root).isFile()) {
        result.push(root);
        continue;
      }
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      continue;
    }
    const subdirs =
      id === "codex"
        ? ["sessions", "archived_sessions"]
        : id === "claude" || id === "qwen"
          ? ["projects"]
          : id === "kimi" || id === "grok"
            ? ["sessions"]
            : [""];
    for (const subdir of subdirs) result.push(...files(path.join(root, subdir), (f) => f.endsWith(suffix)));
  }
  return [...new Set(result)];
}
module.exports = { definitions, sourceRoots, sourceFiles };
