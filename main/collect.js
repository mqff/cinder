const { Collector } = require("./normalize");
const sources = require("./sources");
const catalog = sources.map(({ id, label }) => ({ id, label }));
const { createPricing } = require("./pricing");
const { readRules } = require("./pricing-rules");
const { json } = require("./io");
const path = require("node:path");
const { readT3Tiers } = require("./t3-tiers");
async function collect(cacheDir, report = () => {}) {
  const tiers = await readT3Tiers();
  const collector = new Collector(
    createPricing(json(path.join(__dirname, "..", "pricing-data.json"), {}), cacheDir ? readRules(cacheDir) : []),
    tiers
  );
  collector.loadCache(cacheDir);
  let done = 0,
    files = 0,
    last = 0,
    label = "";
  const progress = (force) => {
    if (!force && Date.now() - last < 150) return;
    last = Date.now();
    report({ done, total: catalog.length, label, files });
  };
  collector.onFile = () => {
    files++;
    progress(false);
  };
  for (const source of sources) {
    label = source.label;
    progress(true);
    try {
      await source.collect(collector);
    } catch (error) {
      collector.diagnostics.push({ source: source.id, message: error.message || String(error) });
    }
    done++;
  }
  label = "";
  progress(true);
  collector.saveCache();
  return { ...collector.result(), catalog };
}
module.exports = { collect };
