const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { cleanOutputs } = require("../tools/clean");
const { Collector } = require("../main/normalize");
const { readSnapshot, writeSnapshot } = require("../main/snapshot");
const { createScanService } = require("../main/scan-service");
const { createWorkerPool } = require("../main/worker-pool");
const { parseRecord } = require("../main/sources/records");
const { configKeys, classify } = require("../main/calls");
const { createPricing } = require("../main/pricing");
const pricingBuild = require("../tools/build-pricing");
const { readJson, lines, files } = require("../main/io");
const { sourceFiles } = require("../main/source-paths");
const { validUsage, validCalls } = require("../main/contracts");

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-audit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("a partial rescan cannot replace a complete snapshot", async (t) => {
  const dir = temporary(t);
  writeSnapshot(dir, { usage: { entries: [], sources: [], scannedAt: "complete" } });
  const pool = {
    run: async () => ({ entries: [], sources: [], diagnostics: [{ source: "codex", message: "Unreadable file" }] })
  };
  const service = createScanService({ dir, usagePool: pool, callsPool: pool });
  assert.match((await service.collect()).warning, /previous snapshot/);
  assert.equal(service.usage().scannedAt, "complete");
});

test("cancel permits an immediate fresh request before the old promise settles", async (t) => {
  const jobs = [];
  const pool = { run: () => new Promise((resolve) => jobs.push(resolve)), stop: () => true };
  const service = createScanService({ dir: temporary(t), usagePool: pool, callsPool: pool });
  const first = service.collect();
  service.cancel();
  const second = service.collect();
  assert.notEqual(first, second);
  assert.equal(jobs.length, 2);
  jobs[0]({ cancelled: true });
  jobs[1]({ entries: [], sources: [], scannedAt: "new" });
  await Promise.all([first, second]);
  assert.equal(service.usage().scannedAt, "new");
});

test("posting failures retire the broken worker and the next scan can start", async () => {
  let starts = 0,
    current;
  const pool = createWorkerPool(() => {
    starts++;
    current = new EventEmitter();
    current.kill = () => {};
    current.postMessage = () => {
      if (starts === 1) throw new Error("port closed");
    };
    return current;
  });
  assert.match((await pool.run({}, {})).error, /port closed/);
  const next = pool.run({}, {});
  current.emit("message", { id: 2, type: "unrecognized", result: "invalid" });
  current.emit("message", { id: 2, type: "done", result: "valid" });
  assert.equal(await next, "valid");
  assert.equal(starts, 2);
  pool.stop();
});

test("invalid numeric snapshot records are rejected before reaching the renderer", (t) => {
  const root = temporary(t);
  fs.writeFileSync(
    path.join(root, "scan-snapshot.json"),
    JSON.stringify({ usage: { entries: [{ t: 1, source: "codex" }], sources: [] } })
  );
  assert.equal(readSnapshot(root), null);
});

test("a broken calls section does not discard a valid saved usage section", (t) => {
  const root = temporary(t);
  fs.writeFileSync(
    path.join(root, "scan-snapshot.json"),
    JSON.stringify({ usage: { entries: [], sources: [] }, calls: { sources: { codex: { total: 1 } } } })
  );
  const saved = readSnapshot(root);
  assert.ok(saved.usage);
  assert.equal(saved.calls, undefined);
});

test("auxiliary metadata changes invalidate usage cache records", async (t) => {
  const root = temporary(t),
    file = path.join(root, "usage.json"),
    summary = path.join(root, "summary.json");
  fs.writeFileSync(file, "{}");
  fs.writeFileSync(summary, "one");
  let parses = 0;
  const parse = async (out) => {
    parses++;
    out.add({ source: "grok", ts: "2026-01-01", input: 1 });
  };
  for (let index = 0; index < 3; index++) {
    if (index === 2) fs.writeFileSync(summary, "different metadata");
    const collector = new Collector();
    collector.loadCache(root);
    await collector.scanFile("grok", root, file, parse, [summary]);
    collector.saveCache();
  }
  assert.equal(parses, 2);
});

test("corrupt JSON is reported and is not stored as a successful empty result", async (t) => {
  const root = temporary(t),
    file = path.join(root, "record.json");
  fs.writeFileSync(file, "{");
  const collector = new Collector();
  collector.loadCache(root);
  await collector.scanFile("amp", root, file, async () => {
    JSON.parse(fs.readFileSync(file));
  });
  assert.equal(collector.diagnostics.length, 1);
  assert.equal(Object.keys(collector.cacheOut).length, 0);
});

test("Codex archived copies are deduplicated by recorded session identity", () => {
  const collector = new Collector();
  for (const file of ["original.jsonl", "archived-copy.jsonl"]) {
    const state = {};
    parseRecord("codex", { type: "session_meta", payload: { id: "session", model: "gpt-5" } }, file, state);
    const records = parseRecord(
      "codex",
      {
        timestamp: "2026-01-01",
        payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, output_tokens: 10 } } }
      },
      file,
      state
    );
    for (const record of records) collector.add(record);
  }
  const entries = collector.result().entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].n, 1);
  assert.equal(entries[0].input, 100);
});

test("Qwen prompt cache is counted once", () => {
  const [record] = parseRecord(
    "qwen",
    {
      timestamp: "2026-01-01",
      usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 80, candidatesTokenCount: 10 }
    },
    "chat.jsonl"
  );
  assert.equal(record.input, 20);
  assert.equal(record.input + record.cacheRead, 100);
});

test("JSONC discovery handles comments, braces in comments, URLs and trailing commas", () => {
  const config =
    '{ // "mcp": { "wrong": {} }\n "mcp": { /* } */ "docs": {"url":"https://example.test/a//b"}, "search": {}, }, }';
  assert.deepEqual(configKeys(config, "mcp"), ["docs", "search"]);
  assert.deepEqual(classify("mcp__docs__search", {}, "id", 1), { i: "id", t: 1, k: "mcp", s: "docs", n: "search" });
});

test("qualified prices take precedence over full-name flat aliases", () => {
  const pricing = createPricing({
    flat: { "proxy/model": { in: 99, out: 99 } },
    qualified: { "provider/model": { in: 2, out: 4 } }
  });
  assert.equal(pricing.priceFor("proxy/model", "provider").in, 2);
});

test("historical rates apply before, but not at, their expiry boundary", () => {
  const pricing = createPricing({
    flat: { model: { in: 2, out: 4, dated: [{ until: "2026-01-01", in: 1, out: 2 }] } }
  });
  assert.equal(pricing.priceFor("model", "", "2025-12-31").in, 1);
  assert.equal(pricing.priceFor("model", "", "2026-01-01").in, 2);
});

test("pricing generation retains explicit zero cache rates and rejects invalid rates", () => {
  const data = pricingBuild.build(
    {
      "claude-test": {
        litellm_provider: "anthropic",
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        cache_creation_input_token_cost: 0,
        cache_read_input_token_cost: 0,
        cache_creation_input_token_cost_above_1hr: 0
      }
    },
    {}
  );
  assert.equal(data.flat["claude-test"].cw, 0);
  assert.equal(data.flat["claude-test"].cr, 0);
  assert.equal(data.flat["claude-test"].cw1h, 0);
  assert.deepEqual(pricingBuild.inflate(pricingBuild.intern(data)), data);
  assert.deepEqual(pricingBuild.validate(data), []);
  data.flat["claude-test"].in = -1;
  assert.ok(pricingBuild.validate(data).length > 0);
});

test("clean only removes declared outputs inside its workspace", (t) => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, "release"));
  fs.writeFileSync(path.join(root, "source.js"), "keep");
  cleanOutputs(root, ["release"]);
  assert.equal(fs.existsSync(path.join(root, "release")), false);
  assert.equal(fs.readFileSync(path.join(root, "source.js"), "utf8"), "keep");
  assert.throws(() => cleanOutputs(root, [".."]));
});

test("clean refuses linked output directories", (t) => {
  const root = temporary(t),
    outside = temporary(t);
  fs.writeFileSync(path.join(outside, "keep"), "keep");
  fs.symlinkSync(outside, path.join(root, "release"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => cleanOutputs(root, ["release"]), /link/);
  assert.equal(fs.readFileSync(path.join(outside, "keep"), "utf8"), "keep");
});

test("JSON and JSONL readers accept UTF-8 BOM files", async (t) => {
  const root = temporary(t),
    file = path.join(root, "bom.json");
  fs.writeFileSync(file, "\ufeff" + '{"value":1}');
  assert.deepEqual(readJson(file), { value: 1 });
  fs.writeFileSync(file, "\ufeff" + '{"value":2}\n');
  const records = [];
  await lines(file, (record) => records.push(record));
  assert.deepEqual(records, [{ value: 2 }]);
});

test("JSON errors do not expose fragments of source content", (t) => {
  const file = path.join(temporary(t), "private.json");
  fs.writeFileSync(file, '{"private_fragment":"not-for-diagnostics", broken');
  assert.throws(
    () => readJson(file),
    (error) => error.message === "Invalid JSON"
  );
});

test("restored calls reject malformed installed integration metadata", () => {
  assert.equal(validCalls({ sources: {}, installed: { skills: "not-an-array", mcp: {} } }), false);
  assert.equal(validCalls({ sources: {}, installed: { skills: [], mcp: { codex: ["docs"] } } }), true);
});

test("restored results reject malformed diagnostics and optional numeric fields", () => {
  const collector = new Collector();
  collector.add({ source: "test", ts: "2026-01-01", input: 10 });
  const usage = collector.result();
  assert.equal(validUsage(usage), true);
  assert.equal(validUsage({ ...usage, diagnostics: [{ source: "test", message: {} }] }), false);
  assert.equal(validCalls({ sources: {}, diagnostics: {} }), false);
  assert.equal(validUsage({ ...usage, entries: [{ ...usage.entries[0], unpriced: "one" }] }), false);
  assert.equal(validUsage({ ...usage, entries: [{ ...usage.entries[0], cacheWrite1h: -1 }] }), false);
});

test("missing cache rates are distinct from explicitly free cache rates", () => {
  const missing = createPricing({ flat: { model: { in: 2, out: 4 } } });
  assert.equal(missing.priceFor("model", "custom").cacheReadKnown, false);
  assert.equal(missing.priceFor("model", "custom").cacheRead, 0);
  const free = createPricing({ flat: { model: { in: 2, out: 4, cr: 0, cw: 0, cw1h: 0 } } });
  assert.equal(free.priceFor("model", "custom").cacheReadKnown, true);
  assert.equal(free.priceFor("model", "custom").cacheWriteKnown, true);
});

test("minute buckets preserve mixed pricing provenance", () => {
  const collector = new Collector();
  const record = {
    source: "test",
    session: "one",
    model: "unpriced-test-model",
    ts: "2026-01-01T12:00:00Z",
    input: 10
  };
  collector.add({ ...record, cost: 1 });
  collector.add(record);
  const bucket = collector.result().entries[0];
  assert.equal(bucket.n, 2);
  assert.equal(bucket.cost, 1);
  assert.equal(bucket.unpriced, 1);
  assert.equal(bucket.costOrigin, "mixed");
});

test("directory discovery distinguishes missing paths from denied access", (t) => {
  const root = temporary(t);
  assert.deepEqual(files(path.join(root, "missing")), []);
  const denied = Object.assign(new Error("Access denied"), { code: "EACCES" });
  const readDirectory = fs.readdirSync;
  t.mock.method(fs, "readdirSync", (dir, options) => {
    if (dir === root) throw denied;
    return readDirectory(dir, options);
  });
  assert.throws(() => files(root), { code: "EACCES" });
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = root;
  t.after(() => {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  });
  const stat = fs.statSync;
  t.mock.method(fs, "statSync", (file, options) => {
    if (file === root) throw denied;
    return stat(file, options);
  });
  assert.throws(() => sourceFiles("claude"), { code: "EACCES" });
});
