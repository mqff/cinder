const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseRecord } = require("../main/sources/records");
const { Collector } = require("../main/normalize");
test("Claude advisor calls retain their own model, tokens and dedup identity", () => {
  const rows = parseRecord(
    "claude",
    {
      timestamp: "2026-11-11",
      sessionId: "session",
      message: {
        id: "request",
        model: "executor",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          iterations: [{ type: "advisor_message", model: "advisor", input_tokens: 50, output_tokens: 10 }]
        }
      }
    },
    __filename
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].input, 100);
  assert.equal(rows[1].model, "advisor");
  assert.equal(rows[1].input, 50);
  const collector = new Collector();
  for (const row of [...rows, ...rows]) collector.add(row);
  assert.equal(collector.result().entries.length, 2);
});
test("Pi counts billed tools and summaries and does not add reasoning to output twice", () => {
  const collector = new Collector(),
    state = {};
  parseRecord("pi", { type: "session", id: "native-session" }, __filename, state);
  const raw = {
    id: "summary",
    timestamp: "2026-11-11",
    type: "compaction",
    usage: { input: 10, output: 20, reasoning: 8, cost: { total: 0.5 } }
  };
  const [summary] = parseRecord("pi", raw, __filename, state);
  collector.add(summary);
  const [copy] = parseRecord("pi", raw, __filename, { session: "fork-copy" });
  collector.add(copy);
  const [record] = collector.result().entries;
  assert.equal(record.model, "Tools/summaries");
  assert.equal(record.output, 20);
  assert.equal(record.reasoning, 8);
  assert.equal(record.cost, 0.5);
  assert.equal(record.n, 1);
  assert.equal(
    parseRecord(
      "pi",
      { ...raw, type: "message", message: { role: "toolResult", usage: raw.usage } },
      __filename,
      state
    )[0].model,
    "Tools/summaries"
  );
});
test("Muse cache counters are subsets of input and copied envelopes count once across sessions", () => {
  const raw = {
    schema_version: 1,
    record_type: "event",
    payload_type: "runtime.session",
    payload_schema_version: 3,
    id: "copy-id",
    recorded_at: 1794398400000000,
    stream: { kind: "session", id: "session" },
    payload: {
      source_run_record_id: "native-request",
      event: {
        kind: "automated_review_completed",
        model: { model_id: "test" },
        usage: { input_tokens: 100, cached_tokens: 40, cache_write_tokens: 10, output_tokens: 20, reasoning_tokens: 5 }
      }
    }
  };
  const collector = new Collector();
  collector.add(parseRecord("muse", raw, __filename)[0]);
  collector.add(
    parseRecord("muse", { ...raw, id: "other-envelope", stream: { kind: "session", id: "child-copy" } }, __filename)[0]
  );
  const [entry] = collector.result().entries;
  assert.equal(entry.input, 50);
  assert.equal(entry.cacheRead, 40);
  assert.equal(entry.cacheWrite, 10);
  assert.equal(entry.output, 20);
  assert.equal(entry.n, 1);
});
