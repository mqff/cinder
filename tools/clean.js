const fs = require("node:fs");
const path = require("node:path");

const outputs = new Set(["release", "dist", "artifacts"]);
function cleanOutputs(root, names) {
  const workspace = fs.realpathSync(root);
  for (const name of names) {
    if (!outputs.has(name)) throw new Error(`Not a generated directory: ${name}`);
    const target = path.join(workspace, name);
    if (!fs.existsSync(target)) continue;
    if (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target) {
      throw new Error(`Refusing to follow a generated-directory link: ${target}`);
    }
    if (path.dirname(target) !== workspace) throw new Error(`Outside workspace: ${target}`);
    fs.rmSync(target, { recursive: true, force: true });
  }
}
if (require.main === module) cleanOutputs(path.resolve(__dirname, ".."), [...outputs]);
module.exports = { cleanOutputs };
