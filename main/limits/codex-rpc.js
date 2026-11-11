const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { exists, QuotaError } = require("./common");

function codexCommand(environment = process.env) {
  const candidates = [
    environment.CINDER_CODEX_BIN,
    ...(environment.PATH || "")
      .split(path.delimiter)
      .map((dir) => path.join(dir, process.platform === "win32" ? "codex.exe" : "codex"))
  ];
  if (process.platform !== "win32")
    candidates.push(
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      path.join(os.homedir(), ".local", "bin", "codex"),
      "/Applications/Codex.app/Contents/Resources/codex"
    );
  if (process.platform === "win32")
    candidates.push(
      path.join(
        environment.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
        "Programs",
        "OpenAI",
        "Codex",
        "bin",
        "codex.exe"
      )
    );
  const binary = candidates.find((candidate) => candidate && exists(candidate));
  if (binary) return { file: binary, args: [] };
  const scripts = [
    path.join(environment.APPDATA || "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js"),
    path.join(os.homedir(), ".npm-global", "lib", "node_modules", "@openai", "codex", "bin", "codex.js")
  ];
  const script = scripts.find(exists);
  if (script) return { file: process.execPath, args: [script] };
  throw new QuotaError("Install Codex CLI to read this account's limits.", "missing-cli");
}

async function withCodex(home, run, options = {}) {
  const command = options.command || codexCommand();
  const child = (options.spawn || spawn)(command.file, [...command.args, "app-server", "--listen", "stdio://"], {
    env: { ...process.env, CODEX_HOME: home, ...(command.args.length ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  const pending = new Map();
  let sequence = 0,
    stopped = false;
  const fail = (message) => {
    stopped = true;
    for (const job of pending.values()) job.reject(new QuotaError(message));
    pending.clear();
  };
  const reader = createInterface({ input: child.stdout });
  child.stderr.resume();
  child.stdin.on("error", () => fail("Codex connection closed."));
  child.on("error", () => fail("Codex could not be started."));
  child.on("exit", () => fail("Codex stopped before replying."));
  reader.on("line", (line) => {
    if (line.length > 1024 * 1024) return fail("Codex returned an unexpected response.");
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id);
    if (message.error)
      job.reject(new QuotaError(`Codex could not complete the quota request (${message.error.code}).`));
    else job.resolve(message.result);
  });
  function write(message) {
    child.stdin.write(JSON.stringify(message) + "\n", (error) => {
      if (error) fail("Codex connection closed.");
    });
  }
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (stopped) return reject(new QuotaError("Codex connection closed."));
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      try {
        write({ id, method, params });
      } catch {
        fail("Codex connection closed.");
      }
    });
  const timer = setTimeout(() => {
    fail("Codex did not answer the quota request.");
    try {
      child.kill();
    } catch {}
  }, options.timeout || 15000);
  try {
    await request("initialize", {
      clientInfo: { name: "cinder", title: "Cinder", version: require("../../package.json").version },
      capabilities: { experimentalApi: true }
    });
    write({ method: "initialized" });
    return await run(request);
  } finally {
    clearTimeout(timer);
    reader.close();
    child.stdin.end();
    try {
      child.kill();
    } catch {}
  }
}
module.exports = { withCodex, codexCommand };
