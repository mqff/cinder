const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPricing } = require("../main/pricing");
const { validateRules, readRules } = require("../main/pricing-rules");
const { Collector } = require("../main/normalize");
const { parseRecord } = require("../main/sources/records");
const { readT3Tiers } = require("../main/t3-tiers");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const catalog = { flat: { base: { in: 2, out: 5, cr: 1 } } };
test("custom prices distinguish blank inheritance from explicit zero and do not change the catalog", () => {
  const prices = createPricing(catalog, [{ model: "alias", target: "base", input: 0 }]);
  assert.equal(prices.priceFor("alias").in, 0);
  assert.equal(prices.priceFor("alias").out, 5);
  assert.equal(prices.priceFor("alias").cacheRead, 1);
  assert.equal(createPricing(catalog).priceFor("base").in, 2);
});
test("tool-specific prices override a global rule and incomplete unknown rates remain unpriced", () => {
  const prices = createPricing({}, [
    { model: "test", input: 1 },
    { model: "test", source: "codex", input: 2, output: 3, cacheRead: 0 }
  ]);
  assert.equal(prices.priceFor("test", "", "", "codex").in, 2);
  assert.equal(prices.priceFor("test").known, false);
  assert.equal(prices.priceFor("test", "", "", "codex").known, true);
  assert.equal(prices.priceFor("test", "", "", "codex").cacheReadKnown, true);
});
test("custom estimates preserve reported costs, including a reported zero", () => {
  const collector = new Collector(createPricing({}, [{ model: "test", input: 10, output: 20 }]));
  collector.add({ ts: "2026-11-11", model: "test", source: "codex", input: 1000000, output: 1, cost: 0 });
  assert.equal(collector.result().entries[0].cost, 0);
  assert.equal(collector.result().entries[0].costOrigin, "reported");
});
test("exclusion rules apply only to the selected model and tool and removal restores its records", () => {
  const raw = { ts: "2026-11-11", model: "test", source: "codex", input: 1 };
  const collector = new Collector(createPricing({}, [{ model: "test", source: "codex", exclude: true }]));
  assert.equal(collector.add(raw), false);
  assert.equal(collector.add({ ...raw, source: "claude" }), true);
  const restored = new Collector();
  assert.equal(restored.add(raw), true);
});
test("pricing rules reject negative prices, nonfinite values, duplicate scopes and malformed mappings", () => {
  for (const value of [
    [{ model: "x", input: -1 }],
    [{ model: "x", output: NaN }],
    [{ model: "X" }, { model: "x" }],
    [{ model: "x", target: {} }],
    [{ model: "x", exclude: "yes" }]
  ])
    assert.throws(() => validateRules(value));
  assert.deepEqual(validateRules([{ model: " x ", input: 0 }]), [{ model: "x", input: 0 }]);
});
test("speed tiers charge their reported rates and retain the standard-rate premium and cache savings", () => {
  const prices = createPricing({
    flat: { test: { in: 2, out: 4, cr: 1, fast: { in: 4, out: 8, cr: 2 }, ultrafast: { in: 10, out: 20, cr: 5 } } }
  });
  const collector = new Collector(prices);
  collector.add({
    ts: "2026-11-11",
    source: "codex",
    model: "test",
    speed: "fast",
    input: 1000000,
    cacheRead: 1000000
  });
  const [entry] = collector.result().entries;
  assert.equal(entry.cost, 6);
  assert.equal(entry.speedPremium, 3);
  assert.equal(entry.cacheSavings, 2);
  assert.equal(prices.priceFor("test", "", "", "", "ultrafast").out, 20);
  assert.equal(createPricing(catalog).priceFor("base", "", "", "", "fast").known, false);
});
test("new custom-priced models charge blank cache categories at the configured input price", () => {
  const prices = createPricing({}, [{ model: "custom", input: 3, output: 5 }]);
  const rate = prices.priceFor("custom");
  assert.equal(rate.cacheRead, 3);
  assert.equal(rate.cacheReadKnown, true);
});
test("Codex transcript settings distinguish Fast, Ultrafast and Standard without merging speed buckets", () => {
  const state = {};
  parseRecord(
    "codex",
    { type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { service_tier: "ultrafast" } } },
    __filename,
    state
  );
  const rows = parseRecord(
    "codex",
    {
      timestamp: "2026-11-11",
      payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10, output_tokens: 2 } } }
    },
    __filename,
    state
  );
  assert.equal(rows[0].speed, "ultrafast");
  assert.equal(rows[0].speedRecorded, true);
  const collector = new Collector();
  collector.add(rows[0]);
  collector.add({ ...rows[0], speed: "fast", dedup: "other" });
  assert.equal(collector.result().entries.length, 2);
});
test("T3 native turn selections backfill initial tiers while explicit transcript settings take precedence", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-tiers-test-"));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(dir, "userdata"));
  fs.writeFileSync(path.join(dir, "userdata", "statev2.sqlite"), "");
  const tiers = await readT3Tiers(
    async () => [
      {
        session: "s",
        turn: "t",
        selection: JSON.stringify({ model: "test", options: [{ id: "serviceTier", value: "priority" }] })
      }
    ],
    dir
  );
  assert.equal(tiers.get(JSON.stringify(["s", "t", "test"])), "fast");
  const collector = new Collector(createPricing({ flat: { test: { in: 1, out: 2, fast: { in: 2, out: 4 } } } }), tiers);
  const raw = { ts: "2026-11-11", source: "codex", model: "test", session: "s", nativeTurn: "t", input: 1000000 };
  collector.add(raw);
  collector.add({ ...raw, speed: "standard", speedRecorded: true, session: "explicit" });
  const entries = collector.result().entries;
  assert.equal(entries[0].speed, "fast");
  assert.equal(entries[1].speed, "standard");
  assert.equal(raw.speed, undefined);
});
test("a corrupt pricing configuration fails explicitly instead of silently reverting to automatic prices", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-prices-test-"));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  assert.deepEqual(readRules(dir), []);
  fs.writeFileSync(path.join(dir, "pricing-rules.json"), '{"model":"private-fragment",');
  assert.throws(
    () => readRules(dir),
    (error) => /invalid/.test(error.message) && !error.message.includes("private-fragment")
  );
});
test("inherited object properties cannot masquerade as free model prices", () => {
  const pricing = createPricing({ flat: {}, qualified: {} });
  for (const model of ["__proto__", "constructor", "toString"]) {
    assert.equal(pricing.priceFor(model).known, false);
    assert.equal(pricing.hasRate(model), false);
  }
});
