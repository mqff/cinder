const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const reader = path.join(__dirname, "sqlite-reader.js").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
function queryAll(file, sql) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [reader, file, sql],
      {
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
      },
      (error, output) => {
        if (error) return resolve(null);
        try {
          const rows = JSON.parse(output);
          resolve(Array.isArray(rows) ? rows : null);
        } catch {
          resolve(null);
        }
      }
    );
  });
}
async function withLiveDb(file, use) {
  let scratch;
  const query = async (sql) => {
    const direct = await queryAll(file, sql);
    if (direct !== null) return direct;
    if (!scratch) {
      scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-sqlite-"));
      try {
        fs.copyFileSync(file, path.join(scratch, "snapshot.db"));
        for (const suffix of ["-wal", "-shm"])
          if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, path.join(scratch, "snapshot.db" + suffix));
      } catch {
        return null;
      }
    }
    return queryAll(path.join(scratch, "snapshot.db"), sql);
  };
  try {
    return await use(query);
  } finally {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}
module.exports = { queryAll, withLiveDb, queryLive: (file, sql) => withLiveDb(file, (query) => query(sql)) };
