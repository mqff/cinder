const fs = require("node:fs");
const path = require("node:path");
const { account, fingerprint, window, requestJson, bearer, iso, json } = require("./common");

function grokWindows(data) {
  const period = data?.config?.currentPeriod;
  const type = period?.type?.replace(/^USAGE_PERIOD_TYPE_/, "");
  const kind = type === "WEEKLY" ? "weekly" : type === "MONTHLY" ? "monthly" : "other";
  const start = iso(period?.start),
    end = iso(period?.end);
  const used = data?.config?.creditUsagePercent ?? (kind !== "other" && start && end && start < end ? 0 : undefined);
  return [
    window("subscription", kind === "weekly" ? "Weekly" : kind === "monthly" ? "Monthly" : "Subscription", used, {
      kind,
      startsAt: start,
      resetsAt: end,
      durationMinutes: start && end ? (Date.parse(end) - Date.parse(start)) / 60000 : undefined
    })
  ].filter(Boolean);
}
async function readGrok(root, request = requestJson) {
  let result = account("grok", root);
  try {
    const custom = Object.keys(process.env).some(
      (key) =>
        /^GROK_(?:OIDC_|OAUTH2_|AUTH_PROVIDER_COMMAND$|LOCAL_AUTH$|CLI_CHAT_PROXY_BASE_URL$|MODELS_BASE_URL$|CONFIG(?:_PATH)?$)/.test(
          key
        ) && process.env[key]
    );
    if (custom || process.env.XAI_API_KEY)
      return {
        ...result,
        message: "Subscription limits require the default Grok login, not a custom endpoint or API key."
      };
    for (const name of ["config.toml", "managed_config.toml", "requirements.toml"]) {
      let contents = "";
      try {
        contents = fs.readFileSync(path.join(root, name), "utf8");
      } catch {}
      if (/^\s*\[\[?\s*(?:auth|grok_com_config|endpoints)(?:\.|\])/m.test(contents))
        return { ...result, message: "This Grok configuration selects a custom account or endpoint." };
    }
    let auth;
    try {
      auth = process.env.GROK_AUTH ? JSON.parse(process.env.GROK_AUTH) : json(path.join(root, "auth.json"));
    } catch {}
    const credential =
      auth?.["https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828"] || auth?.["https://accounts.x.ai/sign-in"];
    if (!credential?.key || credential.auth_mode === "api_key")
      return { ...result, message: "Run grok login to connect a subscription account." };
    result = {
      ...result,
      id: fingerprint("grok", credential.principal_id || credential.user_id || credential.key),
      label: credential.email || "Grok account"
    };
    const response = await request("https://cli-chat-proxy.grok.com/v1/billing?format=credits", {
      headers: bearer(credential.key)
    });
    const windows = grokWindows(response);
    return {
      ...result,
      status: windows.length ? "ready" : "unavailable",
      windows,
      message: windows.length ? undefined : "Grok did not return a subscription allowance."
    };
  } catch (error) {
    return { ...result, status: "error", message: error.message };
  }
}

module.exports = { grokWindows, readGrok };
