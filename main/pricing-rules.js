const path = require("node:path");
const { readJson } = require("./io");
const { writeJsonFile } = require("./jsonfile");

function validateRules(value) {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error("Pricing rules must be a list of at most 1,000 models.");
  const seen = new Set();
  return value.map((item) => {
    if (!item || typeof item.model !== "string" || !item.model.trim() || item.model.length > 256)
      throw new Error("Enter a valid model name.");
    const rule = { model: item.model.trim() };
    for (const key of ["source", "target"]) {
      if (item[key] === undefined || item[key] === "") continue;
      if (typeof item[key] !== "string" || item[key].length > 256) throw new Error("Invalid model mapping.");
      rule[key] = item[key].trim();
    }
    if (item.exclude !== undefined) {
      if (typeof item.exclude !== "boolean") throw new Error("Invalid model inclusion.");
      rule.exclude = item.exclude;
    }
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h"]) {
      if (item[key] === undefined) continue;
      if (!Number.isFinite(item[key]) || item[key] < 0 || item[key] > 1000000)
        throw new Error("Prices must be between 0 and 1,000,000 USD per million tokens.");
      rule[key] = item[key];
    }
    const id = JSON.stringify([rule.source || "", rule.model.toLowerCase()]);
    if (seen.has(id)) throw new Error("Only one pricing rule is allowed per model and tool.");
    seen.add(id);
    return rule;
  });
}
function readRules(dir) {
  try {
    return validateRules(readJson(path.join(dir, "pricing-rules.json")));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("The saved pricing rules are invalid. Check pricing-rules.json in Cinder's data directory.");
  }
}
function saveRules(dir, input) {
  const rules = validateRules(input);
  writeJsonFile(path.join(dir, "pricing-rules.json"), rules);
  return rules;
}
module.exports = { validateRules, readRules, saveRules };
