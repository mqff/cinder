const { validLimits } = require("./contracts");
const path = require("node:path");
const { json } = require("./io");
const { writeJsonFile } = require("./jsonfile");

function createLimitsService({ dir, pool, now = Date.now }) {
  const file = path.join(dir, "limits-snapshot.json");
  const saved = json(file);
  let latest = validLimits(saved) ? saved : null,
    pending = null,
    attemptedAt = 0,
    lastFailure = null;
  const resets = new Map();
  function store(result) {
    if (!validLimits(result)) throw new Error("Quota response was invalid.");
    latest = {
      ...result,
      accounts: result.accounts.map((item) => {
        const previous = latest?.accounts.find(
          (old) =>
            old.id === item.id ||
            (item.profileId &&
              old.profileId === item.profileId &&
              item.label !== "Default account" &&
              old.label === item.label)
        );
        return item.status === "error" && previous?.windows.length
          ? {
              ...item,
              id: previous.id,
              windows: previous.windows,
              lastSuccessAt: previous.lastSuccessAt || previous.checkedAt,
              stale: true,
              resetCredits: previous.resetCredits
            }
          : item;
      })
    };
    try {
      writeJsonFile(file, latest);
    } catch {
      latest = { ...latest, warning: "Limits were read, but the local snapshot could not be saved." };
    }
    return latest;
  }
  function read(force = false) {
    if (pending) return pending;
    const savedAt = Date.parse(latest?.checkedAt) || 0;
    if (!force && (latest || lastFailure) && now() - (attemptedAt || (savedAt <= now() ? savedAt : 0)) < 300000)
      return Promise.resolve(lastFailure || latest);
    attemptedAt = now();
    pending = pool
      .run({ kind: "limits", cacheDir: dir }, { accounts: [], checkedAt: "" })
      .then((result) => {
        if (result.cancelled) return { ...latest, cancelled: true };
        if (result.error) {
          lastFailure = { ...(latest || { checkedAt: "", accounts: [] }), error: result.error };
          return lastFailure;
        }
        lastFailure = null;
        return store(result);
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }
  function consume(input) {
    if (!input || typeof input.accountId !== "string" || typeof input.requestId !== "string")
      return Promise.reject(new Error("Invalid reset request."));
    if (!latest?.accounts.some((account) => account.id === input.accountId))
      return Promise.reject(new Error("Refresh Limits before using a reset credit."));
    const key = `${input.accountId}:${input.requestId}`;
    if (resets.has(key)) return resets.get(key);
    const job = pool
      .run({ kind: "limit-reset", cacheDir: dir, input }, {})
      .then((result) => {
        if (result.error || result.cancelled) return result;
        if (!result.id || !latest) throw new Error("Refresh Limits before using a reset credit.");
        return store({
          ...latest,
          checkedAt: result.checkedAt,
          accounts: latest.accounts.map((item) => (item.id === result.id ? result : item))
        });
      })
      .finally(() => {
        resets.delete(key);
      });
    resets.set(key, job);
    return job;
  }
  return { read, refresh: () => read(true), consume, snapshot: () => latest };
}
module.exports = { createLimitsService };
