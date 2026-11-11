const path = require("node:path");
const { sourceFiles } = require("../source-paths");
const { lines, num, parallel } = require("../io");
const get = (attrs, keys) => keys.map((key) => attrs[key]).find((value) => value != null);
const models = ["gen_ai.response.model", "gen_ai.request.model", "gen_ai.model", "llm.model_name"];
const sessions = ["gen_ai.conversation.id", "session.id", "session_id", "conversation.id"];
async function collect(collector) {
  await parallel(sourceFiles("copilot"), 8, (file) =>
    collector.scanFile("copilot", path.dirname(file), file, async (out) => {
      const records = [],
        traces = new Map();
      await lines(file, (record) => {
        const attrs = record.attributes;
        if (!attrs) return;
        records.push(record);
        const trace = record.trace_id || record.traceId || record.span_context?.trace_id;
        const prior = traces.get(trace) || {};
        traces.set(trace, { model: get(attrs, models) || prior.model, session: get(attrs, sessions) || prior.session });
      });
      for (const record of records) {
        const attrs = record.attributes;
        const trace = record.trace_id || record.traceId || record.span_context?.trace_id;
        const context = traces.get(trace) || {};
        const ts =
          record.time ??
          record.timestamp ??
          record.observed_timestamp ??
          record.observedTimestamp ??
          Number(record.time_unix_nano ?? record.timeUnixNano) / 1e6;
        out.add({
          source: "copilot",
          provider: "github-copilot",
          ts,
          model: get(attrs, models) || context.model || "copilot",
          session: get(attrs, sessions) || context.session || path.basename(file),
          input: num(attrs["gen_ai.usage.input_tokens"]),
          output: num(attrs["gen_ai.usage.output_tokens"]),
          cacheRead: num(attrs["gen_ai.usage.cache_read.input_tokens"]),
          cacheWrite: num(
            get(attrs, ["gen_ai.usage.cache_write.input_tokens", "gen_ai.usage.cache_creation.input_tokens"])
          ),
          reasoning: num(get(attrs, ["gen_ai.usage.reasoning.output_tokens", "gen_ai.usage.reasoning_tokens"])),
          dedup: get(attrs, ["gen_ai.response.id", "response_id"]) || (trace ? `${trace}:${ts}` : undefined)
        });
      }
    })
  );
}
module.exports = { id: "copilot", label: "GitHub Copilot", collect };
