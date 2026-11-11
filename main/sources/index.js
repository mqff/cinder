const { definitions } = require("../source-paths");
const { collectRecords } = require("./records");
const { collectDatabase } = require("./databases");
const specialized = [require("./cursor"), require("./antigravity"), require("./copilot"), require("./grok")];
const databaseSources = new Set(["opencode", "kilo", "goose", "hermes"]);

module.exports = Object.entries(definitions).map(([id, [label]]) => ({
  id,
  label,
  collect:
    specialized.find((source) => source.id === id)?.collect ||
    ((collector) => (databaseSources.has(id) ? collectDatabase(id, collector) : collectRecords(id, collector)))
}));
