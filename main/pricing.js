const { json, num } = require("./io");
const path = require("node:path");

function createPricing(snapshot, rules = []) {
  const resolve = (value) => (typeof value === "number" ? snapshot.rates?.[value] : value);
  const lookup = (map, key) => (map && Object.hasOwn(map, key) ? resolve(map[key]) : undefined);
  const clean = (value) =>
    String(value || "")
      .trim()
      .toLowerCase();
  const cache = new Map();
  const indexedRules = new Map(rules.map((rule) => [JSON.stringify([rule.source || "", clean(rule.model)]), rule]));
  function find(model, provider) {
    const key = JSON.stringify([model, provider]);
    if (cache.has(key)) return cache.get(key);
    const full = clean(model),
      bare = full.split("/").pop();
    const names = [...new Set([full, bare, bare.replace(/[-@](?:\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, "")])];
    const rate =
      names.map((name) => lookup(snapshot.qualified, `${clean(provider)}/${name}`)).find(Boolean) ||
      names.map((name) => lookup(snapshot.flat, name)).find(Boolean) ||
      null;
    cache.set(key, rate);
    return rate;
  }
  function ruleFor(model, source) {
    return (
      indexedRules.get(JSON.stringify([source || "", clean(model)])) ||
      indexedRules.get(JSON.stringify(["", clean(model)]))
    );
  }
  function priceFor(model, provider, ts, source, speed = "standard") {
    const rule = ruleFor(model, source);
    const pricedModel = rule?.target || model;
    let rate = find(pricedModel, provider);
    if (rate?.dated && ts) {
      rate =
        [...rate.dated]
          .sort((a, b) => Date.parse(a.until) - Date.parse(b.until))
          .find((item) => Date.parse(ts) < Date.parse(item.until)) || rate;
    }
    const customPricing =
      rule && ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h"].some((key) => rule[key] !== undefined);
    const tierKnown = speed === "standard" || Boolean(rate?.[speed]) || Boolean(customPricing);
    if (!customPricing && speed !== "standard" && rate?.[speed]) rate = rate[speed];
    const input = num(rate?.in);
    const anthropic = /claude|opus|sonnet|haiku/i.test(pricedModel) || clean(provider) === "anthropic";
    const result = {
      known: Boolean(rate) && tierKnown,
      in: input,
      out: num(rate?.out),
      cacheRead: num(rate?.cr ?? (anthropic ? input * 0.1 : 0)),
      cacheWrite: num(rate?.cw ?? (anthropic ? input * 1.25 : 0)),
      cacheWrite1h: num(rate?.cw1h ?? (anthropic ? input * 2 : 0)),
      cacheReadKnown: Boolean(rate) && (rate.cr !== undefined || anthropic),
      cacheWriteKnown: Boolean(rate) && (rate.cw !== undefined || anthropic),
      cacheWrite1hKnown: Boolean(rate) && (rate.cw1h !== undefined || anthropic)
    };
    if (rule) {
      for (const [field, key] of [
        ["in", "input"],
        ["out", "output"],
        ["cacheRead", "cacheRead"],
        ["cacheWrite", "cacheWrite"],
        ["cacheWrite1h", "cacheWrite1h"]
      ])
        if (rule[key] !== undefined) result[field] = rule[key];
      result.known = (Boolean(rate) && tierKnown) || (rule.input !== undefined && rule.output !== undefined);
      for (const field of ["cacheRead", "cacheWrite", "cacheWrite1h"])
        result[field + "Known"] ||= rule[field] !== undefined;
      if (!rate && rule.input !== undefined && rule.output !== undefined) {
        for (const field of ["cacheRead", "cacheWrite", "cacheWrite1h"]) {
          result[field] = rule[field] ?? (field === "cacheWrite1h" ? rule.cacheWrite : undefined) ?? rule.input;
          result[field + "Known"] = true;
        }
      }
    }
    return result;
  }
  function costParts(model, provider, usage, ts) {
    const rate = priceFor(model, provider, ts, usage.source, usage.speed);
    const long = Math.min(num(usage.cacheWrite), num(usage.cacheWrite1h));
    return {
      input: (num(usage.input) * rate.in) / 1e6,
      output: (num(usage.output) * rate.out) / 1e6,
      cacheRead: (num(usage.cacheRead) * rate.cacheRead) / 1e6,
      cacheWrite: ((num(usage.cacheWrite) - long) * rate.cacheWrite + long * rate.cacheWrite1h) / 1e6
    };
  }
  return {
    priceFor,
    costParts,
    hasRate: (model, provider) => Boolean(find(model, provider)),
    isExcluded: (model, source) => ruleFor(model, source)?.exclude === true
  };
}
module.exports = { ...createPricing(json(path.join(__dirname, "..", "pricing-data.json"), {})), createPricing };
