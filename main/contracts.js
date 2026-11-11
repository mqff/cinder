const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isFinite(value) && value >= 0;
const optional = (value, validate) => value === undefined || validate(value);
const string = (value) => typeof value === "string";
function validMetadata(value) {
  return (
    ["scannedAt", "warning", "error"].every((key) => optional(value[key], string)) &&
    optional(
      value.diagnostics,
      (items) =>
        Array.isArray(items) &&
        items.every(
          (item) => object(item) && string(item.source) && string(item.message) && optional(item.file, string)
        )
    )
  );
}
const strings = ["source", "model", "provider", "project", "session", "ts"];
const numbers = [
  "input",
  "output",
  "cacheWrite",
  "cacheRead",
  "reasoning",
  "cost",
  "costInput",
  "costOutput",
  "costCacheWrite",
  "costCacheRead"
];

function validUsage(value) {
  return (
    object(value) &&
    validMetadata(value) &&
    optional(
      value.catalog,
      (items) => Array.isArray(items) && items.every((item) => object(item) && string(item.id) && string(item.label))
    ) &&
    Array.isArray(value.entries) &&
    Array.isArray(value.sources) &&
    value.entries.every(
      (entry) =>
        object(entry) &&
        strings.every((key) => typeof entry[key] === "string") &&
        Number.isFinite(entry.t) &&
        Number.isFinite(new Date(entry.t).getTime()) &&
        numbers.every((key) => count(entry[key])) &&
        ["cacheWrite1h", "unpriced", "cacheSavings", "speedPremium"].every((key) => optional(entry[key], count)) &&
        optional(entry.speed, (speed) => ["standard", "fast", "ultrafast"].includes(speed)) &&
        optional(entry.costOrigin, (origin) => ["reported", "estimated", "unknown", "mixed"].includes(origin)) &&
        (entry.n === undefined || (Number.isInteger(entry.n) && entry.n > 0))
    ) &&
    value.sources.every(
      (source) =>
        object(source) &&
        typeof source.source === "string" &&
        count(source.files) &&
        count(source.entries) &&
        (source.dir === undefined || typeof source.dir === "string")
    )
  );
}
function validCalls(value) {
  const stat = (item) => object(item) && typeof item.name === "string" && count(item.count);
  return (
    object(value) &&
    validMetadata(value) &&
    (value.installed === undefined ||
      (object(value.installed) &&
        Array.isArray(value.installed.skills) &&
        value.installed.skills.every((item) => typeof item === "string") &&
        object(value.installed.mcp) &&
        Object.values(value.installed.mcp).every(
          (servers) => Array.isArray(servers) && servers.every((item) => typeof item === "string")
        ))) &&
    object(value.sources) &&
    Object.values(value.sources).every(
      (source) =>
        object(source) &&
        count(source.total) &&
        ["tools", "skills", "mcpServers"].every((key) => Array.isArray(source[key]) && source[key].every(stat)) &&
        Array.isArray(source.mcpTools) &&
        source.mcpTools.every((item) => stat(item) && typeof item.server === "string") &&
        object(source.byDay) &&
        Object.values(source.byDay).every(count)
    )
  );
}
function validLimits(value) {
  return (
    value &&
    typeof value.checkedAt === "string" &&
    Array.isArray(value.accounts) &&
    value.accounts.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.provider === "string" &&
        typeof item.label === "string" &&
        ["ready", "unavailable", "error"].includes(item.status) &&
        typeof item.checkedAt === "string" &&
        (item.message === undefined || typeof item.message === "string") &&
        (item.plan === undefined || typeof item.plan === "string") &&
        ["stale", "ordinaryUsageAllowed"].every((key) => item[key] === undefined || typeof item[key] === "boolean") &&
        ["lastSuccessAt", "profileId"].every((key) => item[key] === undefined || typeof item[key] === "string") &&
        (item.locations === undefined ||
          (Array.isArray(item.locations) && item.locations.every((location) => typeof location === "string"))) &&
        Array.isArray(item.windows) &&
        item.windows.every(
          (window) =>
            window &&
            typeof window.id === "string" &&
            typeof window.label === "string" &&
            ["session", "daily", "weekly", "monthly", "other"].includes(window.kind) &&
            Number.isFinite(window.usedPercent) &&
            window.usedPercent >= 0 &&
            window.usedPercent <= 100 &&
            (window.resetsAt === undefined || typeof window.resetsAt === "string") &&
            ["durationMinutes", "usedAmount", "totalAmount"].every(
              (key) => window[key] === undefined || (Number.isFinite(window[key]) && window[key] >= 0)
            ) &&
            ["scope", "unit", "resetSource"].every(
              (key) => window[key] === undefined || typeof window[key] === "string"
            )
        ) &&
        (item.resetCredits === undefined ||
          (item.resetCredits &&
            Number.isInteger(item.resetCredits.available) &&
            item.resetCredits.available >= 0 &&
            (item.resetCredits.canUse === undefined || typeof item.resetCredits.canUse === "boolean") &&
            (item.resetCredits.nextExpiresAt === undefined || typeof item.resetCredits.nextExpiresAt === "string") &&
            (item.resetCredits.options === undefined ||
              (Array.isArray(item.resetCredits.options) &&
                item.resetCredits.options.every(
                  (option) =>
                    option &&
                    ["session", "weekly", "fable", "full"].includes(option.kind) &&
                    typeof option.label === "string" &&
                    typeof option.description === "string" &&
                    Number.isInteger(option.available) &&
                    option.available > 0 &&
                    (option.expiresAt === undefined || typeof option.expiresAt === "string")
                )))))
    )
  );
}
module.exports = { validUsage, validCalls, validLimits };
