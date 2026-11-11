const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectLimits, cursorUsage } = require("../main/limits");
async function diagnose() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-limits-diagnose-"));
  try {
    const before = performance.now();
    const result = await collectLimits(dir);
    const report = {
      checkedAt: result.checkedAt,
      elapsedSeconds: Math.round((performance.now() - before) / 100) / 10,
      accounts: result.accounts.map((item) => ({
        provider: item.provider,
        status: item.status,
        plan: item.plan,
        windows: item.windows.map((window) => ({
          kind: window.kind,
          usedPercent: window.usedPercent,
          hasReset: !!window.resetsAt
        })),
        resetCredits: item.resetCredits?.available,
        message: item.message
      }))
    };
    if (process.argv.includes("--cursor-usage")) {
      report.cursorUsage = [];
      for (const account of result.accounts.filter((item) => item.provider === "cursor" && item.status === "ready")) {
        try {
          const usage = await cursorUsage(dir, { accountId: account.id, days: 7 });
          report.cursorUsage.push({
            requests: usage.entries.reduce((sum, entry) => sum + entry.n, 0),
            tokens: usage.entries.reduce(
              (sum, entry) => sum + entry.input + entry.output + entry.cacheRead + entry.cacheWrite,
              0
            ),
            cost: usage.entries.reduce((sum, entry) => sum + entry.cost, 0),
            omitted: usage.omitted
          });
        } catch {
          report.cursorUsage.push({ error: "Cursor account usage could not be read." });
        }
      }
    }
    const output = path.resolve(__dirname, "..", "artifacts");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "limits-diagnostics.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error("Unexpected diagnosis directory.");
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
diagnose().catch(() => {
  console.error("Limits diagnosis failed.");
  process.exitCode = 1;
});
