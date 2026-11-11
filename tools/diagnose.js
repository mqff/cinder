const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collect } = require("../main/collect");
const { collectCalls } = require("../main/calls");

async function diagnose() {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-diagnose-"));
  try {
    const started = performance.now();
    const usage = await collect(cache);
    const calls = await collectCalls(cache);
    const { summarize, queryUsage } = await import("../src/lib/aggregate.ts");
    const { summarizeCalls } = await import("../src/lib/call-summary.ts");
    const medianMs = (run) => {
      run();
      const samples = Array.from({ length: 9 }, () => {
        const before = performance.now();
        run();
        return performance.now() - before;
      }).sort((a, b) => a - b);
      return Math.round(samples[4] * 100) / 100;
    };
    const aggregationMs = {
      allUsage: medianMs(() => summarize(usage.entries)),
      filterChoices30Days: medianMs(() => queryUsage(usage.entries, 30, { source: "", model: "", project: "" })),
      allCalls: medianMs(() => summarizeCalls(calls, ""))
    };
    const report = {
      scannedAt: usage.scannedAt,
      elapsedSeconds: Math.round((performance.now() - started) / 100) / 10,
      requests: usage.entries.reduce((sum, entry) => sum + (entry.n || 1), 0),
      buckets: usage.entries.length,
      aggregationMs,
      sources: usage.sources.map(({ source, files, entries }) => ({ source, files, requests: entries })),
      calls: Object.fromEntries(Object.entries(calls.sources).map(([source, stats]) => [source, stats.total])),
      warnings: [...usage.diagnostics, ...calls.diagnostics].map(({ source, message }) => ({ source, message }))
    };
    const output = path.resolve(__dirname, "..", "artifacts");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "diagnostics.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
}
diagnose().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
