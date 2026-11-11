const { readSnapshot, snapshotInfo, writeSnapshot } = require("./snapshot");
const { validateRules, saveRules } = require("./pricing-rules");

function createScanService({ dir, usagePool, callsPool }) {
  const pending = new Map();
  let pricingTail = Promise.resolve();
  function scan(kind) {
    if (pending.has(kind)) return pending.get(kind);
    const pool = kind === "calls" ? callsPool : usagePool;
    const fallback =
      kind === "calls"
        ? { sources: {}, installed: { skills: [], mcp: {} }, scannedAt: "" }
        : { entries: [], sources: [], scannedAt: "" };
    const job = pool
      .run({ kind, cacheDir: dir }, fallback)
      .then((result) => {
        if (!result.cancelled && !result.error) {
          if (result.diagnostics?.some((item) => item.source !== "cache")) {
            return { ...result, warning: "Incomplete scan. The previous snapshot was kept." };
          }
          const saved = writeSnapshot(dir, { [kind === "calls" ? "calls" : "usage"]: result });
          if (!saved) return { ...result, warning: "Scan completed, but the snapshot could not be saved." };
        }
        return result;
      })
      .finally(() => {
        if (pending.get(kind) === job) pending.delete(kind);
      });
    pending.set(kind, job);
    return job;
  }
  return {
    collect: () => scan("collect"),
    calls: () => scan("calls"),
    updatePricing(input) {
      const rules = validateRules(input);
      pricingTail = pricingTail
        .catch(() => {})
        .then(async () => {
          if (pending.has("collect")) await pending.get("collect");
          saveRules(dir, rules);
          return scan("collect");
        });
      return pricingTail;
    },
    cancel() {
      pending.clear();
      const stopped = usagePool.stop();
      callsPool.stop();
      return stopped;
    },
    info: () => snapshotInfo(dir),
    usage: () => readSnapshot(dir)?.usage ?? null,
    savedCalls: () => readSnapshot(dir)?.calls ?? null
  };
}
module.exports = { createScanService };
