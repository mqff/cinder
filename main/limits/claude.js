const path = require("node:path");
const { execFile } = require("node:child_process");
const { account, fingerprint, window, requestJson, bearer, iso, json, QuotaError } = require("./common");

function claudeWindows(data) {
  const raw = data?.rate_limits || data;
  const windows = [];
  for (const [key, value] of Object.entries(raw || {})) {
    if (!/^(?:five_hour|seven_day(?:_.+)?)$/.test(key) || !value) continue;
    const kind = key === "five_hour" ? "session" : "weekly";
    const scope = key === "five_hour" || key === "seven_day" ? undefined : key.slice(10);
    const label = key === "five_hour" ? "5-hour" : scope ? `Weekly ${scope.replaceAll("_", " ")}` : "Weekly";
    const row = window(key, label, value.utilization, {
      kind,
      scope,
      durationMinutes: kind === "session" ? 300 : 10080,
      resetsAt: value.resets_at
    });
    if (row) windows.push(row);
  }
  for (const value of Array.isArray(raw?.model_scoped) ? raw.model_scoped : []) {
    if (typeof value?.display_name !== "string" || !value.display_name.trim()) continue;
    const row = window(`model:${value.display_name}`, `Weekly ${value.display_name}`, value.utilization, {
      kind: "weekly",
      scope: value.display_name.trim().toLowerCase().replace(/\s+/g, "_"),
      durationMinutes: 10080,
      resetsAt: value.resets_at
    });
    if (row) windows.push(row);
  }
  const extra = raw?.extra_usage;
  if (extra?.is_enabled && Number.isFinite(extra.monthly_limit) && extra.monthly_limit > 0) {
    const row = window(
      "extra",
      "Extra usage budget",
      Number.isFinite(extra.used_credits) ? (extra.used_credits / extra.monthly_limit) * 100 : extra.utilization,
      {
        kind: "monthly",
        scope: "extra"
      }
    );
    if (row) windows.push(row);
  }
  const spend = raw?.spend;
  if (
    spend?.enabled &&
    spend.used?.currency === spend.limit?.currency &&
    Number.isInteger(spend.used?.exponent) &&
    spend.used.exponent >= 0 &&
    spend.used.exponent <= 6 &&
    spend.used.exponent === spend.limit?.exponent &&
    Number.isFinite(spend.used?.amount_minor) &&
    spend.used.amount_minor >= 0 &&
    Number.isFinite(spend.limit?.amount_minor) &&
    spend.limit.amount_minor > 0
  ) {
    const row = window("extra", "Monthly spend", (spend.used.amount_minor / spend.limit.amount_minor) * 100, {
      kind: "monthly",
      scope: "extra",
      ...(spend.used.currency === "USD"
        ? {
            unit: "USD",
            usedAmount: spend.used.amount_minor / 10 ** spend.used.exponent,
            totalAmount: spend.limit.amount_minor / 10 ** spend.limit.exponent
          }
        : {})
    });
    const previous = windows.findIndex((item) => item.id === "extra");
    if (previous >= 0) windows.splice(previous, 1);
    if (row) windows.push(row);
  }
  return [
    ...new Map(
      windows.map((item) => [JSON.stringify([item.kind, item.scope || "", item.durationMinutes || 0]), item])
    ).values()
  ];
}
function keychainCredentials() {
  return new Promise((resolve) =>
    execFile(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { timeout: 3000, windowsHide: true },
      (error, output) => {
        if (error) return resolve(null);
        try {
          resolve(JSON.parse(output));
        } catch {
          resolve(null);
        }
      }
    )
  );
}
function claudeConfig(root) {
  return (
    json(path.join(root, ".claude.json")) ||
    (root === path.join(require("node:os").homedir(), ".claude")
      ? json(path.join(require("node:os").homedir(), ".claude.json"))
      : null)
  );
}
async function claudeLogin(root) {
  const saved =
    json(path.join(root, ".credentials.json")) ||
    (process.platform === "darwin" && root === path.join(require("node:os").homedir(), ".claude")
      ? await keychainCredentials()
      : null);
  return { oauth: saved?.claudeAiOauth, config: claudeConfig(root)?.oauthAccount };
}
function claudeGrants(data, now = Date.now()) {
  const program = data?.cedar_ember;
  if (program?.eligible !== true || !Array.isArray(program.grants)) return [];
  return program.grants.flatMap((grant) => {
    if (
      !grant ||
      typeof grant.id !== "string" ||
      !/^[a-z0-9_-]{1,40}$/.test(grant.id) ||
      !Number.isInteger(grant.resets_left) ||
      grant.resets_left <= 0 ||
      grant.paused ||
      grant.usable_now !== true ||
      (grant.ends_at != null && (!iso(grant.ends_at) || Date.parse(grant.ends_at) <= now))
    )
      return [];
    const clears = Array.isArray(grant.clears) ? grant.clears : [];
    const session = clears.includes("five_hour"),
      other = clears.some((item) => item !== "five_hour");
    const kind = grant.gives_back_weekly
      ? "fable"
      : ["session", "weekly", "full"].includes(grant.type)
        ? grant.type
        : session && !other
          ? "session"
          : other && !session
            ? "weekly"
            : "full";
    return [
      {
        id: grant.id,
        kind,
        available: grant.resets_left,
        expiresAt: iso(grant.ends_at),
        next: grant.id === program.next_grant_id
      }
    ];
  });
}
function claudeCredits(data, canUse, now = Date.now()) {
  if (data?.cedar_ember?.eligible !== true) return undefined;
  const grants = claudeGrants(data, now);
  const names = {
    session: ["5-hour reset", "Refills the 5-hour allowance."],
    weekly: ["Weekly reset", "Refills the weekly allowance."],
    fable: ["Fable reset", "Refills Fable and returns its weekly usage. Other weekly usage remains."],
    full: ["Full reset", "Refills the 5-hour and weekly allowances."]
  };
  return {
    available: grants.reduce((sum, grant) => sum + grant.available, 0),
    canUse,
    nextExpiresAt: grants.find((grant) => grant.next)?.expiresAt,
    options: Object.entries(names).flatMap(([kind, [label, description]]) => {
      const items = grants.filter((grant) => grant.kind === kind);
      return items.length
        ? [
            {
              kind,
              label,
              description,
              available: items.reduce((sum, grant) => sum + grant.available, 0),
              expiresAt: items[0].expiresAt
            }
          ]
        : [];
    })
  };
}
function claudeIdentity(root, oauth, config) {
  const explicit = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return {
    id: fingerprint(
      "claude",
      explicit ||
        (config?.organizationUuid && config?.emailAddress
          ? `${config.organizationUuid}\0${config.emailAddress.toLowerCase()}`
          : oauth?.refreshToken || oauth?.accessToken || root)
    ),
    label: explicit ? "Configured Claude subscription" : config?.emailAddress || "Claude subscription",
    plan: oauth?.subscriptionType
  };
}
async function readClaude(root, request = requestJson) {
  let result = account("claude", root);
  try {
    if (
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      (process.env.ANTHROPIC_BASE_URL &&
        process.env.ANTHROPIC_BASE_URL.replace(/\/$/, "") !== "https://api.anthropic.com")
    )
      return { ...result, message: "API-key and proxy connections do not report a Claude subscription allowance." };
    const { oauth, config } = await claudeLogin(root);
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN || oauth?.accessToken;
    if (!token) return { ...result, message: "Sign in with Claude Code to see subscription limits." };
    result = { ...result, ...claudeIdentity(root, oauth, config) };
    if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && oauth?.expiresAt && oauth.expiresAt < Date.now())
      return { ...result, status: "error", message: "Claude authorization expired. Open Claude Code to renew it." };
    const response = await request("https://api.anthropic.com/api/oauth/usage?cedar_ember=1", {
      headers: { ...bearer(token), "anthropic-beta": "oauth-2025-04-20" }
    });
    const windows = claudeWindows(response);
    return {
      ...result,
      status: windows.length ? "ready" : "unavailable",
      windows,
      resetCredits: claudeCredits(response, !!config?.organizationUuid && !process.env.CLAUDE_CODE_OAUTH_TOKEN),
      message: windows.length ? undefined : "Claude did not return subscription limits."
    };
  } catch (error) {
    return { ...result, status: "error", message: error.message };
  }
}
async function useClaudeReset(root, input, request = requestJson, beforeConsume = () => {}) {
  if (
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    (process.env.ANTHROPIC_BASE_URL &&
      process.env.ANTHROPIC_BASE_URL.replace(/\/$/, "") !== "https://api.anthropic.com")
  )
    throw new QuotaError("Use the Claude Code subscription login to redeem a reset.");
  const { oauth, config } = await claudeLogin(root);
  if (
    typeof oauth?.accessToken !== "string" ||
    typeof config?.organizationUuid !== "string" ||
    !config.organizationUuid ||
    (oauth.expiresAt && oauth.expiresAt < Date.now())
  )
    throw new QuotaError("Open Claude Code to renew this account's authorization.");
  if (claudeIdentity(root, oauth, config).id !== input.accountId)
    throw new QuotaError("The signed-in account changed. Refresh Limits before using a credit.");
  const headers = { ...bearer(oauth.accessToken), "anthropic-beta": "oauth-2025-04-20" };
  const usage = await request("https://api.anthropic.com/api/oauth/usage?cedar_ember=1", { headers });
  const grants = claudeGrants(usage);
  const grant = input.retry
    ? input.grantId
    : input.resetKind
      ? grants.find((item) => item.kind === input.resetKind)?.id
      : (grants.find((item) => item.next) || grants[0])?.id;
  if (typeof grant !== "string" || !/^[a-z0-9_-]{1,40}$/.test(grant))
    throw new QuotaError("This account has no available credit of this type. Refresh Limits.");
  await beforeConsume({ grantId: grant });
  const response = await request(
    `https://api.anthropic.com/api/organizations/${encodeURIComponent(config.organizationUuid)}/reset_rate_limits`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ program: "cedar_ember", grant_id: grant, request_id: input.requestId })
    }
  );
  const errors = {
    cooldown: "Claude resets are cooling down. Try again later.",
    ineligible: "This account cannot use that reset credit.",
    unavailable: "Claude could not confirm this reset. Retry the same request.",
    not_limited: "The provider reports that this account is not currently limited. No reset was applied."
  };
  if (!["reset", "already_used"].includes(response?.result))
    throw new QuotaError(errors[response?.result] || "Claude could not confirm this reset. Retry the same request.");
  const result = await readClaude(root, request);
  if (result.status !== "ready")
    throw new QuotaError("The reset was accepted, but its updated quotas could not be read. Refresh Limits to check.");
  return result;
}

module.exports = { claudeWindows, claudeCredits, readClaude, useClaudeReset };
