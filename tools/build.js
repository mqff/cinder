const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { cleanOutputs } = require("./clean");

const root = path.resolve(__dirname, "..");
const target = process.argv[2] || "host";
const targets = { host: [], win: ["--win"], mac: ["--mac"], dir: ["--dir"] };
if (!Object.hasOwn(targets, target)) throw new Error(`Unknown build target: ${target}`);

async function build() {
  cleanOutputs(root, ["release", "dist"]);
  const vite = await import("vite");
  await vite.build();
  const packagePath = require.resolve("electron-builder/package.json");
  const cli = path.join(path.dirname(packagePath), require(packagePath).bin["electron-builder"]);
  const result = spawnSync(process.execPath, [cli, ...targets[target], "--publish", "never"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status === 0) require("./verify-package").verifyPackage(root);
  process.exitCode = result.status ?? 1;
}
build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
