const { account, fingerprint, window, iso, QuotaError } = require("./common");
const { withCodex } = require("./codex-rpc");

function codexWindows(response) {
  const buckets = { ...(response?.rateLimits ? { codex: response.rateLimits } : {}), ...response?.rateLimitsByLimitId };
  const output = [];
  for (const [scope, snapshot] of Object.entries(buckets)) {
    for (const [position, data] of [
      ["primary", snapshot?.primary],
      ["secondary", snapshot?.secondary]
    ]) {
      if (!data) continue;
      const minutes = data.windowDurationMins;
      const kind =
        minutes >= 28 * 1440
          ? "monthly"
          : minutes >= 7 * 1440
            ? "weekly"
            : minutes > 0 && minutes <= 1440
              ? "session"
              : "other";
      const label =
        kind === "session"
          ? `${Math.round((minutes / 60) * 10) / 10}-hour`
          : kind === "weekly"
            ? "Weekly"
            : kind === "monthly"
              ? "Monthly"
              : "Reported allowance";
      const row = window(
        `${scope}:${position}`,
        scope === "codex" ? label : `${snapshot.limitName || scope} ${label}`,
        data.usedPercent,
        {
          kind,
          durationMinutes: minutes > 0 ? minutes : undefined,
          resetsAt: data.resetsAt,
          scope: scope === "codex" ? undefined : scope
        }
      );
      if (row) output.push(row);
    }
    const individual = snapshot?.individualLimit;
    if (individual) {
      const row = window(`${scope}:individual`, "Monthly credit limit", 100 - individual.remainingPercent, {
        kind: "monthly",
        resetsAt: individual.resetsAt,
        scope: "credits"
      });
      if (row) output.push(row);
    }
  }
  return output;
}
function codexResult(home, identity, response) {
  const credits = response.rateLimitResetCredits;
  const expiries = credits?.credits
    ?.filter((credit) => credit.status === "available")
    .map((credit) => iso(credit.expiresAt))
    .filter(Boolean)
    .sort();
  return account("codex", home, {
    id: fingerprint("codex", response.accountId || identity.email?.toLowerCase() || home),
    label: identity.email || "Codex account",
    plan: identity.planType || response.rateLimits?.planType,
    status: "ready",
    windows: codexWindows(response),
    ordinaryUsageAllowed:
      typeof response.ordinaryUsageAllowed === "boolean" ? response.ordinaryUsageAllowed : undefined,
    resetCredits:
      credits && Number.isInteger(credits.availableCount) && credits.availableCount >= 0
        ? { available: credits.availableCount, nextExpiresAt: expiries?.[0], canUse: true }
        : undefined
  });
}
async function readCodex(home, rpc = withCodex) {
  let identity;
  try {
    return await rpc(home, async (request) => {
      identity = (await request("account/read", { refreshToken: false }))?.account;
      if (identity?.type !== "chatgpt")
        return account("codex", home, { message: "Sign in to Codex with ChatGPT to see subscription limits." });
      return codexResult(
        home,
        identity,
        await request("account/rateLimits/read", { excludeResetCreditDetails: false })
      );
    });
  } catch (error) {
    return account("codex", home, {
      ...(identity?.email
        ? { id: fingerprint("codex", identity.email.toLowerCase()), label: identity.email, plan: identity.planType }
        : {}),
      status: "error",
      message: error.message
    });
  }
}
async function useCodexReset(home, input, rpc = withCodex, beforeConsume = () => {}) {
  return rpc(home, async (request) => {
    const identity = (await request("account/read", { refreshToken: false }))?.account;
    if (identity?.type !== "chatgpt") throw new QuotaError("This account is no longer signed in to ChatGPT.");
    const before = await request("account/rateLimits/read", { excludeResetCreditDetails: false });
    const current = codexResult(home, identity, before);
    if (current.id !== input.accountId)
      throw new QuotaError("The signed-in account changed. Refresh Limits before using a credit.");
    if (!input.retry && !(current.resetCredits?.available > 0))
      throw new QuotaError("This account has no available reset credit.");
    await beforeConsume();
    const consumed = await request("account/rateLimitResetCredit/consume", { idempotencyKey: input.requestId });
    const after = await request("account/rateLimits/read", { excludeResetCreditDetails: false });
    return codexResult(home, identity, {
      ...after,
      ordinaryUsageAllowed: after.ordinaryUsageAllowed ?? consumed.ordinaryUsageAllowed
    });
  });
}
module.exports = { readCodex, codexWindows, useCodexReset };
