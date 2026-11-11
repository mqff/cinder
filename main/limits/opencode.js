const path = require("node:path");
const { queryLive } = require("../sqlite");
const { account, fingerprint, window, requestJson, bearer, exists, json, QuotaError } = require("./common");

function scheduledReset(period, now = new Date()) {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  if (period === "daily") date.setUTCDate(date.getUTCDate() + 1);
  else if (period === "weekly") date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7));
  else if (period === "monthly") date.setUTCMonth(date.getUTCMonth() + 1, 1);
  else return undefined;
  return date.toISOString();
}
function openCodeWindows(data) {
  return [
    ["rolling", "Go 5-hour", "session", 300],
    ["weekly", "Go Weekly", "weekly", 10080],
    ["monthly", "Go Monthly", "monthly", undefined]
  ]
    .map(([id, label, kind, durationMinutes]) =>
      window(`go:${id}`, label, data?.usage?.[id]?.percent, {
        kind,
        durationMinutes,
        resetsAt: data?.usage?.[id]?.resetsAt
      })
    )
    .filter(Boolean);
}
async function readOpenCode(root, request = requestJson, query = queryLive) {
  let result = account("opencode", root);
  try {
    let auth;
    try {
      auth = process.env.OPENCODE_AUTH_CONTENT
        ? JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
        : json(path.join(root, "auth.json"));
    } catch {}
    const go = auth?.["opencode-go"]?.type === "api" ? auth["opencode-go"].key : process.env.OPENCODE_API_KEY;
    if (go) {
      const data = await request("https://opencode.ai/zen/go/v1/usage", { headers: bearer(go) });
      return {
        ...result,
        id: fingerprint("opencode", go),
        label: "OpenCode Go",
        status: openCodeWindows(data).length ? "ready" : "unavailable",
        windows: openCodeWindows(data)
      };
    }
    const router = auth?.openrouter?.type === "api" ? auth.openrouter.key : undefined;
    if (router) {
      result = { ...result, id: fingerprint("opencode", router), label: "OpenRouter", plan: "API key" };
      const { data } = await request("https://openrouter.ai/api/v1/key", { headers: bearer(router) });
      const windows = [];
      if (Number.isFinite(data?.limit) && data.limit >= 0 && Number.isFinite(data.limit_remaining))
        windows.push(
          window(
            "key-budget",
            "API key budget",
            data.limit === 0 ? 100 : (1 - data.limit_remaining / data.limit) * 100,
            {
              kind: ["daily", "weekly", "monthly"].includes(data.limit_reset) ? data.limit_reset : "other",
              scope: "key-budget",
              usedAmount: Math.max(0, data.limit - data.limit_remaining),
              totalAmount: data.limit,
              unit: "USD",
              resetsAt: scheduledReset(data.limit_reset),
              resetSource: "schedule"
            }
          )
        );
      try {
        const credits = (await request("https://openrouter.ai/api/v1/credits", { headers: bearer(router) })).data;
        if (
          Number.isFinite(credits?.total_credits) &&
          credits.total_credits >= 0 &&
          Number.isFinite(credits.total_usage)
        )
          windows.push(
            window(
              "paid-credits",
              "Paid credits",
              credits.total_credits === 0 ? 100 : (credits.total_usage / credits.total_credits) * 100,
              {
                kind: "other",
                scope: "paid-credits",
                usedAmount: credits.total_usage,
                totalAmount: credits.total_credits,
                unit: "USD"
              }
            )
          );
      } catch {}
      return {
        ...result,
        status: "ready",
        windows: windows.filter(Boolean),
        message: windows.length
          ? "Paid credits and key budgets do not determine whether free models are available."
          : "No API-key spending cap is configured. Subscription-style quota windows are not reported."
      };
    }
    if (exists(path.join(root, "opencode.db"))) {
      const rows = await query(
        path.join(root, "opencode.db"),
        "SELECT value FROM credential WHERE integration_id IN ('opencode','opencode-go') AND active IS NOT 0 ORDER BY active DESC, time_created DESC, id DESC LIMIT 1"
      );
      const stored = rows?.[0]?.value;
      if (stored) {
        let key;
        try {
          const parsed = JSON.parse(stored);
          if (
            parsed.type === "key" &&
            (!parsed.metadata?.server || parsed.metadata.server.replace(/\/$/, "") === "https://opencode.ai/console")
          )
            key = parsed.key;
        } catch {}
        if (key) {
          const data = await request("https://opencode.ai/zen/go/v1/usage", { headers: bearer(key) });
          return {
            ...result,
            id: fingerprint("opencode", key),
            label: "OpenCode Go",
            status: openCodeWindows(data).length ? "ready" : "unavailable",
            windows: openCodeWindows(data)
          };
        }
      }
    }
    return { ...result, message: "Connect OpenCode Go or an OpenRouter API key to read allowances." };
  } catch (error) {
    return {
      ...result,
      status: error instanceof QuotaError && error.code === "access" ? "unavailable" : "error",
      message: error.message
    };
  }
}
module.exports = { scheduledReset, openCodeWindows, readOpenCode };
