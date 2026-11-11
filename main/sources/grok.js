const path = require("node:path");
const { sourceFiles } = require("../source-paths");
const { json, readJson, num, basename, parallel } = require("../io");
const modelName = (value) => String(value || "grok").replace(/-build$/, "");
function splitUsage(usage) {
  if (!usage) return null;
  const cacheRead = num(usage.cachedReadTokens),
    cacheWrite = num(usage.cacheCreationTokens);
  const result = {
    input: Math.max(0, num(usage.inputTokens) - cacheRead - cacheWrite),
    output: num(usage.outputTokens),
    cacheRead,
    cacheWrite,
    reasoning: num(usage.reasoningTokens)
  };
  return Object.values(result).some(Boolean) ? result : null;
}
async function collect(collector) {
  const candidates = sourceFiles("grok", ".json").filter(
    (f) =>
      basename(f) === "usage.json" && !/[\\/](terminal|compaction|compaction_checkpoints|recap_requests)[\\/]/.test(f)
  );
  await parallel(candidates, 8, (file) =>
    collector.scanFile(
      "grok",
      path.dirname(file),
      file,
      async (out) => {
        const usage = readJson(file);
        if (!usage) return;
        const summary = json(path.join(path.dirname(file), "summary.json"), {});
        const session = usage.sessionId || basename(path.dirname(file));
        let project = summary.info?.cwd;
        if (!project) {
          try {
            project = decodeURIComponent(basename(path.dirname(path.dirname(file))));
          } catch {}
        }
        const turns = usage.turns?.length ? usage.turns : [usage.session];
        for (const [index, turn] of turns.entries()) {
          const tokens = splitUsage(turn);
          if (!tokens) continue;
          out.add({
            ...tokens,
            source: "grok",
            provider: "xai",
            session,
            project: basename(project || "grok"),
            ts: turn.endedAt || usage.updatedAt || summary.updated_at || summary.created_at,
            model: modelName(turn.primaryModelId || usage.session?.primaryModelId || summary.current_model_id),
            dedup: `${session}:${turn.turnNumber ?? index}`
          });
        }
      },
      [path.join(path.dirname(file), "summary.json")]
    )
  );
}
function eventFromUpdate(record) {
  const update = record.params?.update;
  if (!update) return null;
  const value = Number(record.timestamp);
  const t = Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : 0;
  const id = update.toolCallId ?? record.params?._meta?.eventId ?? null;
  if (update.sessionUpdate === "user_message_chunk" && update.content?._meta?.displayAsSkill) {
    const n = String(update.content._meta.displayText || update.content.text || "")
      .trim()
      .replace(/^\//, "");
    return n ? { i: id, t, k: "skill", n } : null;
  }
  if (update.sessionUpdate !== "tool_call") return null;
  let name = update._meta?.["x.ai/tool"]?.name || update.title;
  if (name === "use_tool") name = update.rawInput?.tool_name || update.rawInput?.tool || name;
  if (!name) return null;
  const cut = name.indexOf("__");
  return cut > 0
    ? { i: id, t, k: "mcp", s: name.slice(0, cut), n: name.slice(cut + 2) }
    : { i: id, t, k: "tool", n: name };
}
module.exports = {
  id: "grok",
  label: "Grok",
  collect,
  modelName,
  splitUsage,
  eventFromUpdate,
  updatesFiles: () => sourceFiles("grok").filter((f) => basename(f) === "updates.jsonl"),
  KEEP: (line) => /"sessionUpdate"\s*:\s*"tool_call"/.test(line) || line.includes("displayAsSkill")
};
