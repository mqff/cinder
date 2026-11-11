const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { sourceRoots, definitions } = require("../source-paths");
const { writeJsonFile } = require("../jsonfile");
const { desktopRoots, account, json, fingerprint } = require("./common");
const { readCodex, useCodexReset } = require("./codex");
const { readGrok } = require("./grok");
const { readCursor } = require("./cursor");
const { readClaude, useClaudeReset } = require("./claude");
const { readAntigravity } = require("./antigravity");
const { readOpenCode } = require("./opencode");
const { cursorLogin } = require("./cursor-auth");
const { readCursorAccount } = require("./cursor-usage");
const { readRules } = require("../pricing-rules");
const { createPricing } = require("../pricing");
const { validLimits } = require("../contracts");
const readers = {
  codex: readCodex,
  claude: readClaude,
  cursor: readCursor,
  grok: readGrok,
  opencode: readOpenCode,
  antigravity: readAntigravity
};
const profilesFile = (dir) => path.join(dir, "limits-profiles.json");
const lastProfiles = new Map();
const accountUsage = new Map();
function validProfile(value) {
  return (
    value &&
    Object.hasOwn(readers, value.provider) &&
    typeof value.root === "string" &&
    path.isAbsolute(value.root) &&
    value.root.length < 4096
  );
}
function savedProfiles(dir) {
  const profiles = json(profilesFile(dir), []);
  return Array.isArray(profiles) ? profiles.filter(validProfile) : [];
}
function addProfile(dir, profile) {
  if (!validProfile(profile) || !fs.statSync(profile.root).isDirectory())
    throw new Error("Select an existing account directory.");
  const profiles = savedProfiles(dir);
  if (!profiles.some((item) => item.provider === profile.provider && item.root === profile.root))
    profiles.push({ provider: profile.provider, root: profile.root });
  writeJsonFile(profilesFile(dir), profiles);
  return profiles;
}
function removeProfile(dir, profile) {
  if (!validProfile(profile)) throw new Error("Invalid account directory.");
  const profiles = savedProfiles(dir).filter(
    (item) => item.provider !== profile.provider || item.root !== profile.root
  );
  writeJsonFile(profilesFile(dir), profiles);
  return profiles;
}
function discoverProfiles(dir) {
  const candidates = savedProfiles(dir);
  for (const provider of Object.keys(readers)) {
    const roots =
      provider === "antigravity"
        ? [
            ...desktopRoots("Antigravity", process.env.ANTIGRAVITY_USER_DATA_DIR),
            path.join(os.homedir(), ".gemini", "antigravity-ide", "User")
          ]
        : sourceRoots(provider);
    for (const root of roots) {
      try {
        if (fs.statSync(root).isDirectory()) candidates.push({ provider, root });
      } catch {}
    }
  }
  const seen = new Set();
  return candidates.filter((profile) => {
    const key = `${profile.provider}\0${path.resolve(profile.root)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function collectLimits(dir, adapters = readers, report = () => {}) {
  const profiles = discoverProfiles(dir);
  const results = await Promise.all(
    profiles.map(async (profile) => {
      try {
        const result = await adapters[profile.provider](profile.root);
        if (!validLimits({ checkedAt: result?.checkedAt, accounts: [result] }))
          throw new Error("Invalid account quota.");
        if (result.status === "ready") report({ checkedAt: result.checkedAt, accounts: [result] });
        return { profile, result };
      } catch {
        return {
          profile,
          result: account(profile.provider, profile.root, {
            status: "error",
            message: "This account's quota could not be read."
          })
        };
      }
    })
  );
  const accounts = new Map();
  lastProfiles.clear();
  for (const { profile, result } of results) {
    const previous = accounts.get(result.id);
    const locations = [...new Set([...(previous?.locations || []), ...(result.locations || [])])];
    if (previous?.status === "ready" && result.status !== "ready") {
      previous.locations = locations;
      continue;
    }
    result.locations = locations;
    accounts.set(result.id, result);
    lastProfiles.set(result.id, profile);
  }
  for (const provider of Object.keys(definitions)) {
    if (Object.hasOwn(readers, provider)) continue;
    if (sourceRoots(provider).some((root) => fs.existsSync(root))) {
      const result = account(provider, "installed", {
        label: definitions[provider][0],
        message: "This tool does not expose an account allowance through its local history."
      });
      accounts.set(result.id, result);
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    accounts: [...accounts.values()].sort(
      (a, b) =>
        (a.status === "ready" ? 0 : 1) - (b.status === "ready" ? 0 : 1) ||
        a.provider.localeCompare(b.provider) ||
        a.label.localeCompare(b.label)
    )
  };
}
async function consumeReset(dir, input) {
  if (input?.resetKind !== undefined && !["session", "weekly", "fable", "full"].includes(input.resetKind))
    throw new Error("Invalid reset type.");
  if (
    typeof input?.accountId !== "string" ||
    !/^[a-f0-9]{24}$/.test(input.accountId) ||
    typeof input.requestId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(input.requestId)
  )
    throw new Error("Invalid reset request.");
  if (!lastProfiles.has(input.accountId)) await collectLimits(dir);
  const profile = lastProfiles.get(input.accountId);
  if (!profile || !["codex", "claude"].includes(profile.provider))
    throw new Error("Refresh this subscription account before using a reset credit.");
  const file = path.join(dir, "limits-reset-intent.json");
  const previous = json(file);
  const retry = previous?.accountId === input.accountId && previous.requestId === input.requestId;
  return (profile.provider === "codex" ? useCodexReset : useClaudeReset)(
    profile.root,
    { ...input, retry, grantId: retry ? previous.grantId : undefined },
    undefined,
    (details = {}) => {
      writeJsonFile(file, { accountId: input.accountId, requestId: input.requestId, ...details });
    }
  );
}
async function cursorUsage(dir, input) {
  if (
    typeof input?.accountId !== "string" ||
    !/^[a-f0-9]{24}$/.test(input.accountId) ||
    ![7, 30, 90].includes(input.days)
  )
    throw new Error("Invalid Cursor usage request.");
  const rules = readRules(dir);
  const key = `${input.accountId}:${input.days}:${fingerprint(JSON.stringify(rules))}`,
    cached = accountUsage.get(key);
  if (!input.force && cached && Date.now() - Date.parse(cached.scannedAt) < 300000) return cached;
  for (const profile of discoverProfiles(dir).filter((item) => item.provider === "cursor")) {
    const login = await cursorLogin(profile.root);
    if (login?.id !== input.accountId) continue;
    const result = await readCursorAccount(profile.root, input, {
      login: async () => login,
      pricing: createPricing(json(path.join(__dirname, "..", "..", "pricing-data.json"), {}), rules)
    });
    accountUsage.set(key, result);
    while (accountUsage.size > 20) accountUsage.delete(accountUsage.keys().next().value);
    return result;
  }
  throw new Error("The Cursor account changed. Refresh Limits before loading account usage.");
}
module.exports = { collectLimits, consumeReset, cursorUsage, savedProfiles, addProfile, removeProfile, validProfile };
