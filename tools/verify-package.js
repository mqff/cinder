const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const asar = require("@electron/asar");

function findArchives(root) {
  const release = path.join(root, "release");
  const archives = [];
  for (const directory of fs.readdirSync(release, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const relative of ["resources/app.asar", "Cinder.app/Contents/Resources/app.asar"]) {
      const archive = path.join(release, directory.name, relative);
      if (fs.existsSync(archive)) archives.push(archive);
    }
  }
  return archives;
}
function verifyPackage(root) {
  const release = path.join(root, "release");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const archives = findArchives(root);
  assert.ok(archives.length, "No packaged application found");
  function sourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(file) : [file];
    });
  }
  const expected = ["main.js", "preload.js", "pricing-data.json", "package.json", "icon/icon.png", "icon/icon.ico"]
    .map((file) => path.join(root, file))
    .concat(sourceFiles(path.join(root, "main")), sourceFiles(path.join(root, "dist")));
  for (const archive of archives) {
    for (const file of expected) {
      if (path.basename(file) === "package.json") continue;
      const relative = path.relative(root, file);
      assert.ok(asar.extractFile(archive, relative).equals(fs.readFileSync(file)), `Stale packaged file: ${relative}`);
    }
    const packaged = JSON.parse(asar.extractFile(archive, "package.json"));
    assert.equal(packaged.version, manifest.version);
    const entries = asar.listPackage(archive).map((entry) => entry.split(/[\\/]/).filter(Boolean));
    assert.equal(
      entries.some((parts) => ["node_modules", "src", "test", "tools", "docs"].includes(parts[0])),
      false,
      "Development files in package"
    );
    assert.ok(
      fs.existsSync(path.join(path.dirname(archive), "app.asar.unpacked", "main", "sqlite-reader.js")),
      "SQLite helper must be unpacked"
    );
  }
  for (const name of fs.readdirSync(release)) {
    if (/\.(exe|dmg|AppImage|blockmap)$/.test(name))
      assert.ok(name.includes(manifest.version), `Obsolete release file: ${name}`);
  }
  console.log(`Verified ${archives.length} packaged application(s), version ${manifest.version}.`);
}
if (require.main === module) verifyPackage(path.resolve(__dirname, ".."));
module.exports = { verifyPackage, findArchives };
