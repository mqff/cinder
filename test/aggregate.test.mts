import { test } from "node:test";
import assert from "node:assert/strict";
import { blank, summarize, daySeries, hourSeries, queryUsage, streaks } from "../src/lib/aggregate.ts";
import { summarizeCalls } from "../src/lib/call-summary.ts";
import type { Entry } from "../src/lib/types.ts";
const entry = (time: string, source = "claude"): Entry => ({
  ts: time,
  t: Date.parse(time),
  source,
  session: "same-id",
  project: "app",
  model: "model",
  provider: source,
  input: 100,
  output: 20,
  cacheRead: 40,
  cacheWrite: 10,
  reasoning: 0,
  cost: 1,
  costInput: 0.5,
  costOutput: 0.2,
  costCacheRead: 0.2,
  costCacheWrite: 0.1,
  n: 3
});
test("sessions with identical ids from two tools stay distinct", () => {
  const result = summarize([entry("2026-01-01", "claude"), entry("2026-01-01", "codex")]);
  assert.equal(result.sessions, 2);
  assert.equal(result.count, 6);
  assert.equal(result.totals.tokens, 340);
});
test("calendar day series crosses daylight-saving changes without duplicates", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Paris";
  try {
    for (const end of [new Date("2026-03-31T12:00:00"), new Date("2026-10-27T12:00:00")]) {
      const result = daySeries(new Map(), 7, end);
      assert.equal(result.length, 7);
      assert.equal(new Set(result.map((p) => p.key)).size, 7);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
test("period filter includes midnight on the first displayed day", () => {
  const now = new Date(2026, 9, 27, 12),
    start = new Date(2026, 9, 21, 0);
  const selection = { source: "", model: "", project: "" };
  assert.equal(queryUsage([entry(start.toISOString())], 7, selection, now).entries.length, 1);
  assert.equal(queryUsage([entry(new Date(start.getTime() - 1).toISOString())], 7, selection, now).entries.length, 0);
});
test("Today uses 24 local hours and preserves cost, tokens and request totals", () => {
  const now = new Date(2026, 10, 11, 16);
  const records = [
    { ...entry(new Date(2026, 10, 11, 10, 5).toISOString()), cost: 1, unpriced: 1 },
    { ...entry(new Date(2026, 10, 11, 10, 55).toISOString()), cost: 2 },
    { ...entry(new Date(2026, 10, 11, 11).toISOString()), cost: 3 },
    { ...entry(new Date(2026, 10, 10, 10).toISOString()), cost: 99 },
    { ...entry(new Date(2026, 10, 11, 22).toISOString()), cost: 99 }
  ];
  const filtered = queryUsage(records, 1, { source: "", model: "", project: "" }, now);
  const summary = summarize(filtered.entries);
  const hours = hourSeries(summary.byHour);
  assert.equal(hours.length, 24);
  assert.equal(hours[0].key, "00:00");
  assert.equal(hours[23].key, "23:00");
  assert.equal(hours[0].cost, 0);
  assert.equal(hours[10].cost, 3);
  assert.equal(hours[10].tokens, 340);
  assert.equal(hours[10].requests, 6);
  assert.equal(hours[10].unpriced, 1);
  for (const metric of ["cost", "tokens", "requests"] as const)
    assert.equal(
      hours.reduce((sum, hour) => sum + hour[metric], 0),
      summary.totals[metric]
    );
});
test("both occurrences of a repeated local hour retain their usage", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Paris";
  try {
    const summary = summarize([entry("2026-10-25T02:15:00+02:00"), entry("2026-10-25T02:15:00+01:00")]);
    const hours = hourSeries(summary.byHour);
    assert.equal(hours[2].cost, 2);
    assert.equal(hours[2].requests, 6);
    assert.equal(hours[2].tokens, 340);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
test("streaks work across the autumn clock change", () => {
  const map = new Map(["2026-10-24", "2026-10-25", "2026-10-26"].map((day) => [day, blank()]));
  assert.deepEqual(streaks(map, new Date("2026-10-26T12:00:00")), { current: 3, longest: 3 });
});

test("CSV escapes quotes and neutralizes formulas after whitespace", async () => {
  const { usageCsv } = await import("../src/lib/export.ts");
  const csv = usageCsv([{ ...entry("2026-01-01"), model: "  =1+1", project: 'a,"b"' }]);
  assert.ok(csv.startsWith("\ufeffts,source,model"));
  assert.ok(csv.includes('"\'  =1+1"'));
  assert.ok(csv.includes('"a,""b"""'));
});

test("filter choices count the period and the other dimensions, preserving request counts", () => {
  const now = new Date("2026-11-11T12:00:00");
  const records = [
    { ...entry("2026-11-11T10:00:00"), model: "alpha", project: "a", n: 3 },
    { ...entry("2026-11-11T10:00:00"), model: "beta", project: "b", n: 2 },
    { ...entry("2026-11-11T10:00:00", "codex"), model: "alpha", project: "a", n: 5 },
    { ...entry("2026-10-01"), model: "old", n: 7 }
  ];
  const result = queryUsage(records, 7, { source: "claude", model: "alpha", project: "" }, now);
  assert.deepEqual(result.entries, [records[0]]);
  assert.deepEqual(result.facets.source, [
    { name: "codex", requests: 5 },
    { name: "claude", requests: 3 }
  ]);
  assert.deepEqual(result.facets.model, [
    { name: "alpha", requests: 3 },
    { name: "beta", requests: 2 }
  ]);
  assert.deepEqual(result.facets.project, [{ name: "a", requests: 3 }]);
  assert.equal(queryUsage(records, 0, { source: "", model: "", project: "" }).entries, records);
});

test("an empty combination keeps its selected choice available to clear", () => {
  const records = [{ ...entry("2026-11-11"), model: "alpha", project: "a" }];
  const result = queryUsage(records, 0, { source: "claude", model: "missing", project: "a" });
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.facets.model, [
    { name: "alpha", requests: 3 },
    { name: "missing", requests: 0 }
  ]);
});

test("call summaries merge shared names and isolate the selected source", () => {
  const stats = {
    total: 4,
    tools: [{ name: "Read", count: 2 }],
    skills: [{ name: "review", count: 1 }],
    mcpServers: [{ name: "docs", count: 1 }],
    mcpTools: [{ server: "docs", name: "search", count: 1 }],
    byDay: { "2026-11-11": 4 }
  };
  const calls = {
    scannedAt: "2026-11-11",
    sources: {
      claude: stats,
      codex: { ...stats, total: 3, tools: [{ name: "Read", count: 1 }], byDay: { "2026-11-11": 3 } }
    }
  };
  const all = summarizeCalls(calls, "");
  assert.equal(all.total, 7);
  assert.deepEqual(all.tools, [{ name: "Read", value: 3 }]);
  assert.deepEqual(all.mcpTools, [{ name: "docs / search", value: 2 }]);
  assert.equal(all.byDay.get("2026-11-11")?.requests, 7);
  assert.equal(summarizeCalls(calls, "claude").total, 4);
  assert.equal(summarizeCalls(null, "").total, 0);
});
