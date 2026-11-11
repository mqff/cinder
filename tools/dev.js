const { spawn } = require("node:child_process");
const path = require("node:path");
const vite = spawn(
  process.execPath,
  [path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js"), "--host", "127.0.0.1"],
  { stdio: ["ignore", "pipe", "inherit"], windowsHide: true }
);
let desktop,
  closing = false,
  output = "";
function stop(code = 0) {
  if (closing) return;
  closing = true;
  desktop?.kill();
  vite.kill();
  process.exitCode = code;
}
vite.stdout.on("data", (data) => {
  process.stdout.write(data);
  output = (output + data.toString()).slice(-4096);
  if (!desktop && !closing && output.includes("Local:")) {
    const env = { ...process.env, CINDER_DEV: "1" };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = spawn(require("electron"), ["."], { stdio: "inherit", windowsHide: true, env });
    desktop.on("exit", (code) => stop(code || 0));
    desktop.on("error", (error) => {
      console.error(error.message);
      stop(1);
    });
  }
});
vite.on("exit", (code) => stop(code || 0));
vite.on("error", (error) => {
  console.error(error.message);
  stop(1);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
