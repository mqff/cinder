const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { compactEntries } = require("../main/normalize");
const { envDirs, num } = require("../main/io");
const { writeJsonFile } = require("../main/jsonfile");
const { costParts } = require("../main/pricing");

describe("envDirs", () => {
  it("splits on comma and semicolon", () => {
    process.env.CINDER_TEST_DIRS =
      process.platform === "win32" ? "C:\\Users\\me\\.claude;D:\\logs" : "/home/a/.claude,/home/b/.codex";
    const dirs = envDirs("CINDER_TEST_DIRS");
    delete process.env.CINDER_TEST_DIRS;
    if (process.platform === "win32") {
      assert.deepEqual(dirs, ["C:\\Users\\me\\.claude", "D:\\logs"]);
    } else {
      assert.deepEqual(dirs, ["/home/a/.claude", "/home/b/.codex"]);
    }
  });

  it("does not split windows drive letters", () => {
    if (process.platform !== "win32") return;
    process.env.CINDER_TEST_DIRS = "C:\\Users\\me\\.claude";
    const dirs = envDirs("CINDER_TEST_DIRS");
    delete process.env.CINDER_TEST_DIRS;
    assert.deepEqual(dirs, ["C:\\Users\\me\\.claude"]);
  });
});

describe("num", () => {
  it("coerces finite numbers", () => {
    assert.equal(num("3"), 3);
    assert.equal(num(null), 0);
    assert.equal(num(NaN), 0);
  });
});

describe("compactEntries", () => {
  it("merges the same session/model within a minute", () => {
    const t = Date.parse("2026-01-01T00:00:10Z");
    const base = {
      source: "claude",
      model: "opus",
      provider: "anthropic",
      project: "app",
      session: "s1",
      input: 10,
      output: 2,
      cacheWrite: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
      reasoning: 0,
      cost: 1,
      costInput: 1,
      costOutput: 0,
      costCacheWrite: 0,
      costCacheRead: 0
    };
    const out = compactEntries([
      { ...base, t },
      { ...base, t: t + 1000, input: 5, cost: 0.5, costInput: 0.5 }
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].n, 2);
    assert.equal(out[0].input, 15);
    assert.equal(out[0].cost, 1.5);
  });

  it("keeps separate minutes", () => {
    const t = Date.parse("2026-01-01T00:00:10Z");
    const base = {
      source: "claude",
      model: "opus",
      provider: "anthropic",
      project: "app",
      session: "s1",
      input: 1,
      output: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
      reasoning: 0,
      cost: 0,
      costInput: 0,
      costOutput: 0,
      costCacheWrite: 0,
      costCacheRead: 0
    };
    const out = compactEntries([
      { ...base, t },
      { ...base, t: t + 60 * 1000 }
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].n, 1);
  });
});

describe("writeJsonFile", () => {
  it("roundtrips a nested object", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-"));
    const file = path.join(dir, "out.json");
    const value = { v: 2, entries: [{ a: 1 }, { a: 2 }], nested: { ok: true } };
    writeJsonFile(file, value);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), value);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("costParts", () => {
  it("returns zeros for unknown models", () => {
    const c = costParts("definitely-not-a-model", "unknown", {
      input: 1000,
      output: 1000,
      cacheWrite: 0,
      cacheWrite1h: 0,
      cacheRead: 0
    });
    assert.equal(c.input + c.output + c.cacheWrite + c.cacheRead, 0);
  });

  it("prices a known claude snapshot alias", () => {
    const { priceFor } = require("../main/pricing");
    const p = priceFor("claude-sonnet-4-20250514", "anthropic");
    assert.equal(p.known, true);
    assert.equal(p.in, 3);
    assert.equal(p.out, 15);
  });
});

describe("grok source", () => {
  it("splits cache out of input tokens", () => {
    const { splitUsage, modelName } = require("../main/sources/grok");
    const u = splitUsage({
      inputTokens: 199982,
      outputTokens: 1390,
      cachedReadTokens: 159744,
      cacheCreationTokens: 0,
      reasoningTokens: 346
    });
    assert.equal(u.input, 40238);
    assert.equal(u.cacheRead, 159744);
    assert.equal(u.output, 1390);
    assert.equal(u.reasoning, 346);
    assert.equal(modelName("grok-4.6-build"), "grok-4.6");
  });

  it("parses mcp use_tool and ignores tool_call_update", () => {
    const { KEEP, eventFromUpdate } = require("../main/sources/grok");
    assert.equal(KEEP('{"sessionUpdate": "tool_call_update"}'), false);
    assert.equal(KEEP('{"sessionUpdate": "tool_call"}'), true);
    const ev = eventFromUpdate({
      timestamp: 1790098824,
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "c1",
          title: "use_tool",
          rawInput: { tool_name: "ida-pro-mcp__find" },
          _meta: { "x.ai/tool": { name: "use_tool" } }
        }
      }
    });
    assert.equal(ev.k, "mcp");
    assert.equal(ev.s, "ida-pro-mcp");
    assert.equal(ev.n, "find");
    assert.equal(ev.t, 1790098824000);
  });

  it("collects per-turn usage from GROK_HOME", async () => {
    const { Collector } = require("../main/normalize");
    const grok = require("../main/sources/grok");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-grok-"));
    const session = path.join(dir, "sessions", "proj", "sess-1");
    fs.mkdirSync(session, { recursive: true });
    fs.writeFileSync(
      path.join(session, "summary.json"),
      JSON.stringify({ info: { cwd: "C:\\work\\Cinder" }, current_model_id: "grok-4.6" })
    );
    fs.writeFileSync(
      path.join(session, "usage.json"),
      JSON.stringify({
        sessionId: "sess-1",
        updatedAt: "2026-09-22T17:41:06.123Z",
        turns: [
          {
            turnNumber: 1,
            endedAt: "2026-09-22T17:41:06.123Z",
            inputTokens: 100,
            outputTokens: 20,
            cachedReadTokens: 40,
            cacheCreationTokens: 0,
            reasoningTokens: 5,
            primaryModelId: "grok-4.6-build"
          }
        ]
      })
    );
    const prev = process.env.GROK_HOME;
    process.env.GROK_HOME = dir;
    try {
      const cx = new Collector();
      await grok.collect(cx);
      const res = cx.result();
      assert.equal(res.entries.length, 1);
      assert.equal(res.entries[0].input, 60);
      assert.equal(res.entries[0].cacheRead, 40);
      assert.equal(res.entries[0].output, 25);
      assert.equal(res.entries[0].model, "grok-4.6");
      assert.equal(res.entries[0].project, "Cinder");
      assert.equal(grok.id, "grok");
    } finally {
      if (prev == null) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pricing-data.json", () => {
  it("is interned and pretty-printed", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "pricing-data.json"), "utf8");
    assert.ok(raw.startsWith("{\n"));
    const data = JSON.parse(raw);
    assert.ok(Array.isArray(data.rates) && data.rates.length > 0);
    const sample = Object.values(data.flat)[0];
    assert.equal(typeof sample, "number");
    assert.ok(data.rates[sample] && typeof data.rates[sample].in === "number");
  });
});
