const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { fixtures } = require("../test/fixtures.cjs");
if (!process.env.CI) throw new Error("Run native launch checks on an isolated CI runner.");
if (!["darwin", "win32"].includes(process.platform)) throw new Error("Unsupported native launch platform.");
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cinder-native-"));
const output = path.resolve(__dirname, "..", "artifacts");
const label = `native-${process.platform}-${process.arch}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child,
  socket,
  debuggerUrl,
  mounted = false,
  logs = "";
const pending = new Map();
let sequence = 0;
async function waitFor(check, message, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error("Packaged app exited early.");
    const result = await check();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`Timed out: ${message}`);
}
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 30000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function run() {
  fs.mkdirSync(output, { recursive: true });
  const { env } = fixtures(root);
  let executable;
  const { version } = require("../package.json");
  if (process.platform === "darwin") {
    const image = path.resolve("release", `Cinder-${version}-${process.arch}.dmg`);
    const mount = path.join(root, "mount");
    fs.mkdirSync(mount);
    execFileSync("hdiutil", ["attach", image, "-readonly", "-nobrowse", "-mountpoint", mount], { stdio: "inherit" });
    mounted = true;
    const app = path.join(root, "Cinder.app");
    execFileSync("ditto", [path.join(mount, "Cinder.app"), app]);
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
    const signature = spawnSync("codesign", ["--display", "--verbose=4", app], { encoding: "utf8" });
    assert.equal(signature.status, 0, signature.stderr);
    assert.match(signature.stderr, /^Identifier=app\.local\.cinder$/m);
    assert.match(signature.stderr, /^Signature=adhoc$/m);
    executable = path.join(app, "Contents", "MacOS", "Cinder");
    assert.equal(
      execFileSync("lipo", ["-archs", executable], { encoding: "utf8" }).trim(),
      process.arch === "arm64" ? "arm64" : "x86_64"
    );
  } else executable = path.resolve("release", "win-unpacked", "Cinder.exe");
  const environment = {
    ...process.env,
    ...env,
    HOME: root,
    USERPROFILE: root,
    APPDATA: path.join(root, "roaming"),
    LOCALAPPDATA: path.join(root, "local")
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.CINDER_DEV;
  child = spawn(
    executable,
    [
      `--user-data-dir=${path.join(root, "user-data")}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1"
    ],
    { env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  );
  child.on("error", (error) => {
    logs += error.stack;
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      logs = (logs + data.toString()).slice(-32768);
      debuggerUrl ||= logs.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
    });
  await waitFor(() => debuggerUrl, "native debugger");
  const origin = `http://${new URL(debuggerUrl).host}`;
  const target = await waitFor(async () => {
    const pages = await fetch(`${origin}/json/list`).then((response) => response.json());
    return pages.find((page) => page.type === "page" && page.url.startsWith("file:"));
  }, "packaged renderer");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const done = pending.get(message.id);
    if (done) {
      pending.delete(message.id);
      done(message);
    }
  });
  await waitFor(
    () => evaluate(`!!document.querySelector('.stats-grid') && !document.querySelector('.scan-progress')`),
    "native scan",
    60000
  );
  const info = await evaluate("window.cinder.snapshotInfo()");
  assert.equal(info.sources, 19);
  assert.ok(info.entries > 0);
  const calls = await evaluate("window.cinder.calls()");
  assert.ok(calls.sources.claude.total > 0);
  for (let index = 0; index < 8; index++) {
    await evaluate(`document.querySelectorAll('.sidebar nav button')[${index}].click()`);
    await sleep(150);
    assert.equal(await evaluate(`!!document.querySelector('[role="alert"]')`), false);
  }
  const screenshot = await command("Page.captureScreenshot");
  fs.writeFileSync(path.join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  fs.writeFileSync(
    path.join(output, `${label}.json`),
    JSON.stringify(
      {
        passed: true,
        version,
        platform: process.platform,
        arch: process.arch,
        sources: info.sources,
        entries: info.entries,
        fromDmg: process.platform === "darwin"
      },
      null,
      2
    )
  );
  console.log(`Native launch passed: ${process.platform} ${process.arch}, version ${version}.`);
}
run()
  .catch((error) => {
    console.error(error);
    console.error(logs);
    process.exitCode = 1;
  })
  .finally(async () => {
    socket?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    if (mounted) execFileSync("hdiutil", ["detach", path.join(root, "mount")], { stdio: "inherit" });
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
