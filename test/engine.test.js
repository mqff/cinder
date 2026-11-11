const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fixtures } = require("./fixtures.cjs");
const { Collector } = require("../main/normalize");
const { collect } = require("../main/collect");
const { collectCalls, extract } = require("../main/calls");
const { readSnapshot, writeSnapshot, snapshotInfo } = require("../main/snapshot");
const { createScanService } = require("../main/scan-service");
const { normalizeWindowState } = require("../main/window-state");
const { createWorkerPool } = require("../main/worker-pool");
const { EventEmitter } = require("node:events");
const { parseRecord } = require("../main/sources/records");
const { lines } = require("../main/io");
const { writeJsonFile } = require("../main/jsonfile");
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("all 19 sources: fresh scan, deduplication, cache replay and calls", async (t) => {
  const root = temporary(t),
    cache = path.join(root, "cache");
  const { env } = fixtures(root),
    previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  t.after(() => {
    for (const key of Object.keys(env))
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
  });
  const progress = [];
  const result = await collect(cache, (value) => progress.push(value));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(new Set(result.entries.map((e) => e.source)).size, 19);
  assert.equal(progress.at(-1).done, 19);
  const bySource = Object.fromEntries(result.entries.map((e) => [e.source, e]));
  assert.equal(bySource.claude.output, 30);
  assert.equal(bySource.claude.n, 1);
  assert.equal(bySource.codex.input, 70);
  assert.equal(bySource.codex.cacheRead, 70);
  assert.equal(bySource.codex.output, 30);
  assert.equal(bySource.codex.n, 2);
  assert.equal(bySource.codex.project, "app");
  assert.equal(bySource.gemini.input, 60);
  assert.equal(bySource.gemini.output, 25);
  assert.equal(bySource.cursor.input, 0);
  assert.equal(bySource.cursor.n, 1);
  assert.equal(bySource.antigravity.input, 100);
  assert.equal(bySource.antigravity.n, 1);
  assert.equal(bySource.hermes.cost, 0.03);
  assert.equal(bySource.hermes.costOrigin, "reported");
  assert.equal(bySource.hermes.costInput, 0);
  assert.equal(bySource.cursor.unpriced, 0);
  const repeat = await collect(cache);
  assert.deepEqual(repeat.entries, result.entries);
  const calls = await collectCalls(cache);
  assert.deepEqual(calls.diagnostics, []);
  assert.equal(calls.sources.claude.total, 3);
  assert.equal(calls.sources.codex.total, 2);
  assert.equal(calls.sources.cursor.total, 1);
  assert.equal(calls.sources.grok.total, 1);
  assert.equal(calls.sources.opencode.total, 1);
  assert.deepEqual((await collectCalls(cache)).sources, calls.sources);
  const { DatabaseSync } = require("node:sqlite");
  const server = `audit_${path.basename(root).replace(/\W/g, "_")}`;
  const config = path.join(root, "opencode", "opencode.json");
  fs.writeFileSync(config, JSON.stringify({ mcp: { [server]: {}, [server + "_v2"]: {} } }));
  const database = new DatabaseSync(path.join(root, "opencode", "opencode.db"));
  database
    .prepare("INSERT INTO part VALUES (?, ?)")
    .run(JSON.stringify({ type: "tool", tool: `${server}_v2_find`, callID: "config-call" }), Date.now());
  database.close();
  const configured = await collectCalls(cache);
  assert.equal(configured.sources.opencode.mcpTools[0].server, server + "_v2");
  fs.writeFileSync(config, JSON.stringify({ mcp: { [server]: {} } }));
  const reconfigured = await collectCalls(cache);
  assert.equal(reconfigured.sources.opencode.mcpTools[0].server, server);
  assert.equal(reconfigured.sources.opencode.mcpTools[0].name, "v2_find");
  const damaged = path.join(root, "claude", "projects", "app", "session.jsonl");
  fs.appendFileSync(damaged, '{"tool_use": broken}\n');
  const invalidDatabase = new DatabaseSync(path.join(root, "opencode", "opencode.db"));
  invalidDatabase.prepare("INSERT INTO part VALUES (?, ?)").run("{broken", Date.now());
  invalidDatabase.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    const partial = await collectCalls(cache);
    assert.equal(partial.sources.claude.total, calls.sources.claude.total);
    assert.equal(partial.sources.opencode.total, reconfigured.sources.opencode.total);
    assert.deepEqual(partial.diagnostics.map((item) => item.source).sort(), ["claude", "opencode"]);
    const saved = JSON.parse(fs.readFileSync(path.join(cache, "calls-cache.json")));
    assert.equal(saved.files[`claude:${damaged}`], undefined);
    assert.equal(saved.files[`opencode:${path.join(root, "opencode", "opencode.db")}`], undefined);
  }
});
test("collector scopes message ids by source and session; invalid values cannot corrupt totals", () => {
  const collector = new Collector();
  const entry = {
    source: "test",
    session: "one",
    ts: "2026-01-01",
    model: "no-price",
    input: 10,
    output: 2,
    dedup: "id"
  };
  collector.add(entry);
  collector.add({ ...entry, output: 4 });
  collector.add({ ...entry, session: "two" });
  collector.add({ ...entry, ts: "invalid", dedup: "bad" });
  const result = collector.result();
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].output, 4);
  assert.equal(result.entries[0].unpriced, 1);
});
test("snapshot cache is isolated by directory and migrates old usage", (t) => {
  const root = temporary(t),
    first = path.join(root, "one"),
    second = path.join(root, "two");
  assert.equal(writeSnapshot(first, { usage: { entries: [], sources: [], scannedAt: "2026-01-01" } }), true);
  assert.equal(readSnapshot(second), null);
  assert.equal(snapshotInfo(first).savedAt, "2026-01-01");
  fs.mkdirSync(second, { recursive: true });
  fs.writeFileSync(path.join(second, "scan-snapshot.json"), '{"usage":{"entries":{}}}');
  const corrupt = path.join(root, "invalid");
  fs.mkdirSync(corrupt, { recursive: true });
  fs.writeFileSync(path.join(corrupt, "scan-snapshot.json"), '{"usage":{"entries":{}}}');
  assert.equal(readSnapshot(corrupt), null);
});
test("failed and cancelled rescans retain the last successful snapshot", async (t) => {
  const dir = temporary(t),
    original = { entries: [], sources: [], scannedAt: "before" };
  writeSnapshot(dir, { usage: original });
  let finish,
    runs = 0;
  const pool = {
    run: () => {
      runs++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    stop: () => true
  };
  const service = createScanService({ dir, usagePool: pool, callsPool: pool });
  const first = service.collect(),
    second = service.collect();
  assert.equal(first, second);
  assert.equal(runs, 1);
  finish({ error: "disk unavailable" });
  await first;
  assert.equal(service.usage().scannedAt, "before");
  const third = service.collect();
  finish({ cancelled: true });
  await third;
  assert.equal(service.usage().scannedAt, "before");
});
test("worker cancellation settles jobs; a late exit cannot kill its replacement", async () => {
  const children = [];
  const pool = createWorkerPool(() => {
    const child = new EventEmitter();
    child.postMessage = () => {};
    child.kill = () => {};
    children.push(child);
    return child;
  });
  const first = pool.run({ kind: "collect" }, { entries: [] });
  pool.stop();
  assert.equal((await first).cancelled, true);
  const second = pool.run({ kind: "collect" }, {});
  children[0].emit("exit", 1);
  children[1].emit("message", { type: "done", id: 2, result: { ok: true } });
  assert.deepEqual(await second, { ok: true });
  pool.stop();
});
test("worker startup and process errors resolve even when termination fails", async () => {
  const pool = createWorkerPool(() => {
    throw new Error("cannot spawn");
  });
  assert.match((await pool.run({}, { entries: [] })).error, /cannot spawn/);
  const child = new EventEmitter();
  child.postMessage = () => {};
  child.kill = () => {
    throw new Error("process already stopped");
  };
  const running = createWorkerPool(() => child).run({}, { entries: [] });
  assert.doesNotThrow(() => child.emit("error", new Error("process failed")));
  assert.match((await running).error, /process failed/);
});
test("Codex call_id deduplicates the same function call", () => {
  const events = extract("codex", {
    timestamp: "2026-01-01",
    payload: { type: "function_call", call_id: "call", name: "mcp__docs__search" }
  });
  assert.deepEqual(events[0], { i: "call", t: Date.parse("2026-01-01"), k: "mcp", s: "docs", n: "search" });
  const neighbouring = extract("claude", {
    timestamp: "2026-01-01",
    message: { content: [null, { type: "tool_use", name: 7 }, { type: "tool_use", name: "Skill", input: null }] }
  });
  assert.equal(neighbouring.length, 1);
  assert.equal(neighbouring[0].n, "unknown");
});

test("Grok filtering retains skills whose display text mentions tool_call_update", () => {
  const grok = require("../main/sources/grok");
  const record = {
    timestamp: Date.now(),
    params: {
      update: {
        sessionUpdate: "user_message_chunk",
        content: { _meta: { displayAsSkill: true, displayText: "/inspect-tool_call_update" } }
      }
    }
  };
  assert.equal(grok.KEEP(JSON.stringify(record)), true);
  assert.equal(grok.eventFromUpdate(record).k, "skill");
});
test("invalid window geometry falls back to usable dimensions", () => {
  const state = normalizeWindowState({ width: "broken", height: -200, x: NaN, bg: "#12345" });
  assert.equal(state.width, 1280);
  assert.equal(state.height, 600);
  assert.equal(state.x, undefined);
  assert.equal(state.bg, "#171819");
});

test("Codebuff camelCase token fields and Gemini alternate timestamps remain readable", () => {
  const time = "2026-01-01T12:00:00Z";
  const rows = parseRecord(
    "codebuff",
    { timestamp: time, metadata: { usage: { inputTokens: 12, outputTokens: 3 } } },
    "chat.json"
  );
  assert.equal(rows[0].input, 12);
  assert.equal(rows[0].output, 3);
  const gemini = parseRecord("gemini", { last_updated: time, tokens: { input: 20, output: 4 } }, "chat.json");
  assert.equal(gemini[0].ts, time);
});

test("Codex cache-ratio changes and counter resets preserve total deltas", () => {
  const state = {};
  const record = (input, cache, output) =>
    parseRecord(
      "codex",
      {
        timestamp: "2026-01-01",
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: input, cached_input_tokens: cache, output_tokens: output } }
        }
      },
      "session.jsonl",
      state
    )[0];
  record(100, 0, 20);
  const changed = record(120, 90, 25);
  assert.equal(changed.input + changed.cacheRead, 20);
  assert.equal(changed.output, 5);
  const reset = record(40, 10, 8);
  assert.equal(reset.input + reset.cacheRead, 40);
  assert.equal(reset.output, 8);
});

test("JSONL handles CRLF, malformed and truncated records without dropping valid neighbours", async (t) => {
  const file = path.join(temporary(t), "stream.jsonl");
  fs.writeFileSync(file, '{"id":1}\r\ninvalid\n{"id":2}\n{"id":');
  const records = [];
  await lines(file, (record) => records.push(record));
  assert.deepEqual(records, [{ id: 1 }, { id: 2 }]);
});

test("atomic JSON writes preserve sparse arrays and leave old data intact on encoding failure", (t) => {
  const dir = temporary(t),
    file = path.join(dir, "snapshot.json");
  const data = { values: [1, , undefined, 4], omit: undefined };
  writeJsonFile(file, data);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), JSON.parse(JSON.stringify(data)));
  const previous = fs.readFileSync(file, "utf8");
  assert.throws(() => writeJsonFile(file, { value: 1n }));
  assert.equal(fs.readFileSync(file, "utf8"), previous);
  assert.deepEqual(fs.readdirSync(dir), ["snapshot.json"]);
});

test("reported zero cost remains zero after a repeated record without a cost field", () => {
  const collector = new Collector();
  const record = {
    ts: "2026-01-01",
    source: "claude",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    session: "one",
    dedup: "message",
    input: 100,
    output: 10
  };
  collector.add({ ...record, cost: 0 });
  collector.add({ ...record, output: 20 });
  const entry = collector.result().entries[0];
  assert.equal(entry.cost, 0);
  assert.equal(entry.costOrigin, "reported");
  assert.equal(entry.costInput, 0);
});

test("WAL changes invalidate cached database records", async (t) => {
  const root = temporary(t),
    file = path.join(root, "usage.db"),
    cache = path.join(root, "cache");
  fs.writeFileSync(file, "database");
  let parses = 0;
  const parse = async (out) => {
    parses++;
    out.add({ source: "test", ts: "2026-01-01", input: parses });
  };
  for (let index = 0; index < 2; index++) {
    const collector = new Collector();
    collector.loadCache(cache);
    await collector.scanFile("test", root, file, parse);
    collector.saveCache();
  }
  assert.equal(parses, 1);
  fs.writeFileSync(file + "-wal", "new transaction");
  const collector = new Collector();
  collector.loadCache(cache);
  await collector.scanFile("test", root, file, parse);
  assert.equal(parses, 2);
});
