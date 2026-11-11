const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createInterface } = require("node:readline");
const HOME = os.homedir();
const num = (value) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
const basename = (value) =>
  String(value || "")
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || "unknown";
function envDirs(name) {
  return [
    ...new Set(
      (process.env[name] || "")
        .split(/[,;]/)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => (v.startsWith("~/") || v.startsWith("~\\") ? path.join(HOME, v.slice(2)) : path.resolve(v)))
    )
  ];
}
function roots(name, defaults) {
  const configured = envDirs(name);
  return configured.length ? configured : defaults;
}
function json(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}
function readJson(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }
}
function files(root, match = () => true) {
  const found = [],
    pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    let children;
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      continue;
    }
    for (const child of children) {
      const full = path.join(dir, child.name);
      if (child.isDirectory()) pending.push(full);
      else if (child.isFile() && match(full)) found.push(full);
    }
  }
  return found.sort();
}
async function lines(file, receive, filter, onMalformed) {
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  let malformed = 0;
  try {
    for await (const line of reader) {
      if (!line.trim() || (filter && !filter(line))) continue;
      let record;
      try {
        record = JSON.parse(line.replace(/^\uFEFF/, ""));
      } catch {
        malformed++;
        continue;
      }
      if (record && typeof record === "object") receive(record);
    }
  } finally {
    reader.close();
    input.destroy();
  }
  if (malformed) onMalformed?.(malformed);
}
async function parallel(items, count, visit) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, Math.max(1, count)) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await visit(items[index], index);
      }
    })
  );
}
function toIso(value) {
  if (value == null || value === "") return null;
  const time = typeof value === "number" && value < 1e12 ? value * 1000 : value;
  const date = new Date(time);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function signature(file) {
  const stat = fs.statSync(file);
  let result = `${stat.mtimeMs}:${stat.size}`;
  try {
    const wal = fs.statSync(file + "-wal");
    result += `:${wal.mtimeMs}:${wal.size}`;
  } catch {}
  return result;
}
module.exports = { HOME, num, basename, envDirs, roots, json, readJson, files, lines, parallel, toIso, signature };
