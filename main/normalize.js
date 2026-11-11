const path = require("node:path");
const { num, toIso, json, signature } = require("./io");
const pricing = require("./pricing");
const { writeJsonFile } = require("./jsonfile");
const USAGE_VERSION = 4;
const sums = [
  "input",
  "output",
  "cacheWrite",
  "cacheWrite1h",
  "cacheRead",
  "reasoning",
  "cost",
  "costInput",
  "costOutput",
  "costCacheWrite",
  "costCacheRead",
  "unpriced",
  "cacheSavings",
  "speedPremium"
];
function compactEntries(entries) {
  const buckets = new Map();
  for (const record of entries) {
    const key = JSON.stringify([
      record.source,
      record.provider,
      record.model,
      record.speed || "standard",
      record.project,
      record.session,
      Math.floor(record.t / 60000)
    ]);
    const current = buckets.get(key);
    if (!current) buckets.set(key, { ...record, n: record.n || 1 });
    else {
      for (const field of sums) current[field] = (current[field] || 0) + (record[field] || 0);
      current.n += record.n || 1;
      if (current.costOrigin !== record.costOrigin) current.costOrigin = "mixed";
      if (record.t < current.t) {
        current.t = record.t;
        current.ts = record.ts;
      }
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}
class Collector {
  constructor(prices = pricing, tiers = new Map()) {
    this.pricing = prices;
    this.tiers = tiers;
    this.entries = [];
    this.seen = new Map();
    this.sources = new Map();
    this.cacheIn = {};
    this.cacheOut = {};
    this.diagnostics = [];
    this.onFile = null;
  }
  loadCache(dir) {
    if (!dir) return;
    this.cachePath = path.join(dir, "scan-cache.json");
    const saved = json(this.cachePath);
    if (saved?.v === 6) this.cacheIn = saved.files || {};
  }
  saveCache() {
    if (!this.cachePath) return;
    try {
      writeJsonFile(this.cachePath, { v: 6, files: this.cacheOut });
    } catch (error) {
      this.diagnostics.push({ source: "cache", message: error.message });
    }
  }
  async scanFile(source, dir, file, parse, dependencies = []) {
    const fingerprint = () =>
      [
        signature(file),
        ...dependencies.map((dependency) => {
          try {
            return signature(dependency);
          } catch {
            return "missing";
          }
        })
      ].join("|");
    let sig;
    try {
      sig = fingerprint();
    } catch (error) {
      if (error.code !== "ENOENT") this.diagnostics.push({ source, file, message: error.message });
      return;
    }
    const key = source + ":" + file;
    const cached = this.cacheIn[key];
    let records;
    try {
      let warned = false;
      if (cached?.sig === sig && Array.isArray(cached.e)) records = cached.e;
      else {
        records = [];
        await parse({
          add: (entry) => records.push(entry),
          warn: (message) => {
            warned = true;
            this.diagnostics.push({ source, file, message });
          }
        });
      }
      if (fingerprint() === sig && !warned) this.cacheOut[key] = { sig, e: records };
      const meta = this.sources.get(source) || { source, dir, files: 0, entries: 0 };
      meta.files++;
      for (const record of records) if (this.add(record)) meta.entries++;
      this.sources.set(source, meta);
    } catch (error) {
      this.diagnostics.push({ source, file, message: error.message || String(error) });
    } finally {
      this.onFile?.();
    }
  }
  add(raw) {
    if (this.pricing.isExcluded(raw.model || "unknown", raw.source)) return false;
    const ts = toIso(raw.ts);
    if (!ts) return false;
    const entry = {
      ...raw,
      ts,
      t: Date.parse(ts),
      model: raw.model || "unknown",
      speed: ["fast", "ultrafast"].includes(raw.speed) ? raw.speed : "standard",
      provider: raw.provider || raw.source,
      project: raw.project || raw.source,
      session: raw.session || raw.source
    };
    for (const field of ["input", "output", "cacheWrite", "cacheWrite1h", "cacheRead", "reasoning"])
      entry[field] = num(raw[field]);
    if (entry.source === "codex" && !raw.speedRecorded)
      entry.speed = this.tiers.get(JSON.stringify([entry.session, raw.nativeTurn, entry.model])) || entry.speed;
    delete entry.nativeTurn;
    delete entry.speedRecorded;
    if (!raw.reasoningIncluded) entry.output += entry.reasoning;
    if (!raw.allowEmpty && entry.input + entry.output + entry.cacheWrite + entry.cacheRead === 0) return false;
    const key = raw.dedup
      ? JSON.stringify([entry.source, ...(raw.dedupGlobal ? [] : [entry.session]), raw.dedup])
      : null;
    const previous = key && this.seen.get(key);
    if (previous) {
      for (const field of ["input", "output", "cacheWrite", "cacheWrite1h", "cacheRead", "reasoning"])
        previous[field] = Math.max(previous[field], entry[field]);
      this.price(previous, raw.cost ?? (previous.costOrigin === "reported" ? previous.cost : undefined));
      return false;
    }
    this.price(entry, raw.cost);
    delete entry.dedup;
    delete entry.allowEmpty;
    delete entry.reasoningIncluded;
    delete entry.dedupGlobal;
    this.entries.push(entry);
    if (key) this.seen.set(key, entry);
    return true;
  }
  price(entry, reported) {
    const parts = this.pricing.costParts(entry.model, entry.provider, entry, entry.ts);
    const rate = this.pricing.priceFor(entry.model, entry.provider, entry.ts, entry.source, entry.speed);
    const missingRate =
      !rate.known ||
      (entry.cacheRead > 0 && !rate.cacheReadKnown) ||
      (entry.cacheWrite > 0 && !rate.cacheWriteKnown) ||
      (entry.cacheWrite1h > 0 && !rate.cacheWrite1hKnown);
    entry.costInput = parts.input;
    entry.costOutput = parts.output;
    entry.costCacheWrite = parts.cacheWrite;
    entry.costCacheRead = parts.cacheRead;
    const hasReported = typeof reported === "number" && Number.isFinite(reported) && reported >= 0;
    entry.cost = hasReported ? reported : Object.values(parts).reduce((a, b) => a + b, 0);
    if (hasReported) {
      entry.costInput = 0;
      entry.costOutput = 0;
      entry.costCacheWrite = 0;
      entry.costCacheRead = 0;
    }
    entry.unpriced =
      entry.input + entry.output + entry.cacheWrite + entry.cacheRead > 0 && !hasReported && missingRate ? 1 : 0;
    entry.costOrigin = hasReported ? "reported" : entry.unpriced ? "unknown" : "estimated";
    const standard =
      entry.speed === "standard"
        ? parts
        : this.pricing.costParts(entry.model, entry.provider, { ...entry, speed: "standard" }, entry.ts);
    entry.speedPremium =
      !hasReported && rate.known
        ? Math.max(
            0,
            Object.values(parts).reduce((a, b) => a + b, 0) - Object.values(standard).reduce((a, b) => a + b, 0)
          )
        : 0;
    entry.cacheSavings =
      !hasReported && rate.known && rate.cacheReadKnown
        ? Math.max(0, ((rate.in - rate.cacheRead) * entry.cacheRead) / 1e6)
        : 0;
  }
  result() {
    return {
      v: USAGE_VERSION,
      entries: compactEntries(this.entries),
      sources: [...this.sources.values()],
      diagnostics: this.diagnostics,
      scannedAt: new Date().toISOString()
    };
  }
}
module.exports = { Collector, compactEntries, USAGE_VERSION };
