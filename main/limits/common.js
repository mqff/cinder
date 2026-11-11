const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { json } = require("../io");

const fingerprint = (...parts) => crypto.createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
const percent = (value) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
function iso(value) {
  if (!["number", "string"].includes(typeof value) || value === "") return undefined;
  const numeric = typeof value === "number" || /^\d+$/.test(value) ? Number(value) : null;
  const date = new Date(numeric === null ? value : numeric < 1e12 ? numeric * 1000 : numeric);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date.toISOString() : undefined;
}
function window(id, label, used, options = {}) {
  const usedPercent = percent(used);
  if (usedPercent === null || typeof id !== "string" || typeof label !== "string") return null;
  const row = { id, label, usedPercent, kind: options.kind || "other", resetsAt: iso(options.resetsAt) };
  for (const key of ["scope", "resetSource", "unit"]) if (typeof options[key] === "string") row[key] = options[key];
  for (const key of ["durationMinutes", "usedAmount", "totalAmount"])
    if (Number.isFinite(options[key]) && options[key] >= 0) row[key] = options[key];
  return row;
}
function account(provider, profile, details = {}) {
  const result = {
    id: fingerprint(provider, profile),
    profileId: fingerprint(provider, profile),
    locations: path.isAbsolute(profile) ? [profile] : [],
    provider,
    label: "Default account",
    status: "unavailable",
    windows: [],
    checkedAt: new Date().toISOString(),
    ...details
  };
  if (typeof result.label !== "string") result.label = "Default account";
  if (typeof result.plan !== "string") delete result.plan;
  return result;
}
class QuotaError extends Error {
  constructor(message, code = "request") {
    super(message);
    this.code = code;
  }
}
async function requestJson(url, options = {}, request = fetch) {
  let response;
  try {
    response = await request(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
  } catch {
    throw new QuotaError("The provider did not respond. Try refreshing again.");
  }
  if (!response.ok) {
    const code =
      response.status === 401
        ? "auth"
        : response.status === 403
          ? "access"
          : response.status === 429
            ? "rate"
            : "request";
    throw new QuotaError(
      code === "auth"
        ? "Authorization expired. Sign in again in the provider's app."
        : code === "access"
          ? "This account cannot report this quota."
          : code === "rate"
            ? "The provider is rate limiting quota checks. Try again later."
            : `The provider returned HTTP ${response.status}.`,
      code
    );
  }
  let text;
  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader(),
        chunks = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 1024 * 1024) {
            await reader.cancel();
            throw new Error("oversized");
          }
          chunks.push(Buffer.from(part.value));
        }
        text = Buffer.concat(chunks).toString("utf8");
      } finally {
        reader.releaseLock();
      }
    } else text = await response.text();
  } catch {
    throw new QuotaError("The provider returned an unreadable response.");
  }
  if (text.length > 1024 * 1024) throw new QuotaError("The provider returned an unexpected response.");
  try {
    return JSON.parse(text);
  } catch {
    throw new QuotaError("The provider returned an invalid response.");
  }
}
const bearer = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
function desktopRoots(name, override) {
  if (override)
    return override
      .split(/[,;]/)
      .filter(Boolean)
      .map((root) => path.resolve(root));
  const home = os.homedir();
  return process.platform === "win32"
    ? [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), name, "User")]
    : process.platform === "darwin"
      ? [path.join(home, "Library", "Application Support", name, "User")]
      : [path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), name, "User")];
}
function exists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
module.exports = {
  fingerprint,
  percent,
  iso,
  window,
  account,
  requestJson,
  bearer,
  desktopRoots,
  exists,
  json,
  QuotaError
};
