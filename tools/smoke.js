const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { fixtures } = require("../test/fixtures.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-smoke-"));
try {
  const { env } = fixtures(root);
  const large = process.argv.includes("--large");
  require("../test/smoke-history.cjs")(root, large);
  const executable = require("electron");
  const environment = { ...process.env, ...env, CINDER_SMOKE_ROOT: root };
  environment.CINDER_SMOKE_LARGE = large ? "1" : "0";
  if (process.argv.includes("--package")) {
    const archives = require("./verify-package").findArchives(path.resolve(__dirname, ".."));
    if (!archives.length) throw new Error("Build an unpacked application before running packaged smoke");
    environment.CINDER_SMOKE_APP = path.join(archives[0], "main.js");
  } else delete environment.CINDER_SMOKE_APP;
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(executable, [path.join(__dirname, "electron-smoke.cjs")], {
    stdio: "inherit",
    windowsHide: true,
    timeout: 90000,
    env: environment
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
