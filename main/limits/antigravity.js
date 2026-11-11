const path = require("node:path");
const { queryLive } = require("../sqlite");
const { fields } = require("../sources/antigravity");
const { account, fingerprint, window, requestJson, bearer, json } = require("./common");

function googleAccessToken(bytes, depth = 0) {
  if (depth > 6 || bytes.length > 100000) return undefined;
  const text = bytes.toString("utf8"),
    match = text.match(/ya29\.[A-Za-z0-9._-]+/);
  if (match) return match[0];
  for (const field of fields(bytes))
    if (field.bytes) {
      const token = googleAccessToken(field.bytes, depth + 1);
      if (token) return token;
    }
  if (text.length > 30 && /^[A-Za-z0-9+/=_-]+$/.test(text))
    return googleAccessToken(Buffer.from(text, "base64"), depth + 1);
}
function antigravityWindows(data, requestedAt = Date.now()) {
  const windows = [];
  const groups =
    Array.isArray(data?.groups) && data.groups.some((group) => Array.isArray(group?.buckets) && group.buckets.length)
      ? data.groups
      : [{ buckets: data?.buckets }];
  for (const group of groups) {
    for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
      if (typeof bucket?.bucketId !== "string") continue;
      if (bucket.disabled || !Number.isFinite(bucket.remainingFraction)) continue;
      const minutes = bucket.window === "5h" ? 300 : bucket.window === "weekly" ? 10080 : undefined;
      const kind = bucket.window === "5h" ? "session" : bucket.window === "weekly" ? "weekly" : "other";
      const family = /^gemini-argon-/.test(bucket.bucketId)
        ? group.displayName || "Gemini Argon"
        : /^gemini-carbon-/.test(bucket.bucketId)
          ? group.displayName || "Gemini Carbon"
          : /^gemini-/.test(bucket.bucketId)
            ? "Gemini"
            : /^3p-/.test(bucket.bucketId)
              ? "Claude & GPT"
              : group.displayName || bucket.displayName || bucket.bucketId;
      const scope = /^gemini-argon-/.test(bucket.bucketId)
        ? "gemini-argon"
        : /^gemini-carbon-/.test(bucket.bucketId)
          ? "gemini-carbon"
          : /^gemini-/.test(bucket.bucketId)
            ? "gemini"
            : /^3p-/.test(bucket.bucketId)
              ? "3p"
              : bucket.bucketId;
      const resetsAt =
        bucket.remainingFraction === 1 &&
        minutes &&
        !bucket.description &&
        Math.abs(Date.parse(bucket.resetTime) - requestedAt - minutes * 60000) < 60000
          ? undefined
          : bucket.resetTime;
      const row = window(
        bucket.bucketId,
        `${family} ${kind === "session" ? "5-hour" : kind === "weekly" ? "Weekly" : "Quota"}`,
        (1 - bucket.remainingFraction) * 100,
        { kind, durationMinutes: minutes, resetsAt, scope }
      );
      if (row) windows.push(row);
    }
  }
  return windows;
}
async function readAntigravity(root, request = requestJson, query = queryLive) {
  let result = account("antigravity", root);
  try {
    const rows = await query(
      path.join(root, "globalStorage", "state.vscdb"),
      "SELECT key, value FROM ItemTable WHERE key IN ('antigravityAuthStatus', 'antigravityUnifiedStateSync.oauthToken')"
    );
    const values = Object.fromEntries((rows || []).map((row) => [row.key, row.value]));
    let status;
    try {
      status = JSON.parse(values.antigravityAuthStatus);
    } catch {}
    const saved = json(path.join(root, "antigravity-acp", "acp_token.json")) || json(path.join(root, "acp_token.json"));
    let token = googleAccessToken(Buffer.from(values["antigravityUnifiedStateSync.oauthToken"] || "", "base64"));
    if (
      typeof saved?.refresh_token === "string" &&
      typeof saved.client_id === "string" &&
      typeof saved.client_secret === "string"
    ) {
      const refreshed = await request("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: saved.client_id,
          client_secret: saved.client_secret,
          refresh_token: saved.refresh_token,
          grant_type: "refresh_token"
        }).toString()
      });
      if (typeof refreshed.access_token === "string") token = refreshed.access_token;
    }
    if (!token) return { ...result, message: "Open Antigravity and sign in with Google to read quotas." };
    result = {
      ...result,
      id: fingerprint("antigravity", status?.email || status?.apiKey || token),
      label: status?.email || "Google account"
    };
    const hosts = ["daily-cloudcode-pa.googleapis.com", "cloudcode-pa.googleapis.com"];
    async function probe(operation, parse) {
      const results = await Promise.allSettled(
        hosts.map(async (host) => {
          const time = Date.now();
          const data = await request(`https://${host}/v1internal:${operation}`, {
            method: "POST",
            headers: bearer(token),
            body: JSON.stringify(saved?.project_id ? { project: saved.project_id } : {})
          });
          return parse(data, time);
        })
      );
      const output = new Map();
      for (const item of results)
        if (item.status === "fulfilled") for (const row of item.value) if (!output.has(row.id)) output.set(row.id, row);
      return { output, error: results.find((item) => item.status === "rejected")?.reason };
    }
    let { output, error } = await probe("retrieveUserQuotaSummary", antigravityWindows);
    if (!output.size && error?.code !== "auth")
      ({ output, error } = await probe("fetchAvailableModels", (data) =>
        Object.entries(data?.models || {}).flatMap(([id, model]) =>
          [
            ["quota", model?.quotaInfo],
            ["weekly", model?.weeklyQuotaInfo]
          ].flatMap(([suffix, quota]) => {
            const row =
              quota && Number.isFinite(quota.remainingFraction)
                ? window(
                    `${id}:${suffix}`,
                    `${id}${suffix === "weekly" ? " Weekly" : ""}`,
                    (1 - quota.remainingFraction) * 100,
                    { kind: suffix === "weekly" ? "weekly" : "other", scope: id, resetsAt: quota.resetTime }
                  )
                : null;
            return row ? [row] : [];
          })
        )
      ));
    if (!output.size && error) throw error;
    return {
      ...result,
      status: output.size ? "ready" : "unavailable",
      windows: [...output.values()],
      message: output.size ? undefined : "Antigravity did not return quota windows."
    };
  } catch (error) {
    return { ...result, status: "error", message: error.message };
  }
}

module.exports = { googleAccessToken, antigravityWindows, readAntigravity };
