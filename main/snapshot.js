const path = require("node:path");
const { json } = require("./io");
const { writeJsonFile } = require("./jsonfile");
const { compactEntries, USAGE_VERSION } = require("./normalize");
const { validUsage, validCalls } = require("./contracts");
const memory = new Map();
const location = (dir) => path.join(dir, "scan-snapshot.json");
function readSnapshot(dir) {
  const file = location(dir);
  if (memory.has(file)) return memory.get(file);
  let saved = json(file);
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    if (!validUsage(saved.usage)) delete saved.usage;
    if (!validCalls(saved.calls)) delete saved.calls;
    if (!saved.usage && !saved.calls) saved = null;
  } else saved = null;
  if (saved?.usage && saved.usage.v !== USAGE_VERSION) {
    saved.usage = { ...saved.usage, v: USAGE_VERSION, entries: compactEntries(saved.usage.entries) };
  }
  memory.set(file, saved);
  return saved;
}
function snapshotInfo(dir) {
  const snapshot = readSnapshot(dir);
  if (!snapshot?.usage) return null;
  return {
    savedAt: snapshot.usage.scannedAt || snapshot.savedAt || "",
    entries: snapshot.usage.entries.reduce((sum, entry) => sum + (entry.n || 1), 0),
    sources: snapshot.usage.sources.length,
    hasCalls: Boolean(snapshot.calls)
  };
}
function writeSnapshot(dir, patch) {
  const next = { ...readSnapshot(dir), ...patch, savedAt: new Date().toISOString() };
  try {
    writeJsonFile(location(dir), next);
    memory.set(location(dir), next);
    return true;
  } catch {
    return false;
  }
}
module.exports = { readSnapshot, snapshotInfo, writeSnapshot };
