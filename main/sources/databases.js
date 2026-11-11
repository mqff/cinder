const path = require("node:path");
const { files, readJson, num, basename, parallel } = require("../io");
const { sourceRoots } = require("../source-paths");
const { queryLive } = require("../sqlite");
const { parseMessage } = require("./_message");
async function collectDatabase(source, collector) {
  const databases = sourceRoots(source).flatMap((root) =>
    files(root, (file) => {
      const name = basename(file);
      return source === "opencode"
        ? /^opencode(?:-[\w.-]+)?\.db$/.test(name)
        : source === "kilo"
          ? name === "kilo.db"
          : source === "hermes"
            ? name === "state.db"
            : name === "sessions.db";
    })
  );
  for (const file of databases)
    await collector.scanFile(source, path.dirname(file), file, async (out) => {
      if (source === "opencode" || source === "kilo") {
        const sessions = await queryLive(file, "SELECT id, directory FROM session");
        const projects = new Map((sessions || []).map((s) => [s.id, basename(s.directory)]));
        const messages = await queryLive(file, "SELECT id, session_id, data FROM message");
        if (!messages) throw new Error("Unable to read message database");
        for (const row of messages) {
          let message;
          try {
            message = JSON.parse(row.data);
          } catch {
            continue;
          }
          const entry = parseMessage(message, {
            source,
            session: row.session_id,
            project: projects.get(row.session_id)
          });
          if (entry) out.add(entry);
        }
      } else {
        const rows = await queryLive(file, "SELECT * FROM sessions");
        if (!rows) throw new Error("Unable to read sessions database");
        for (const session of rows) {
          if (source === "hermes" && !session.model) continue;
          let model = session.model;
          if (source === "goose") {
            let config;
            try {
              config = JSON.parse(session.model_config_json);
            } catch {
              continue;
            }
            model = config.model_name || config.model;
          }
          const input = num(session.accumulated_input_tokens) || num(session.input_tokens);
          const output = num(session.accumulated_output_tokens) || num(session.output_tokens);
          out.add({
            source,
            ts: source === "hermes" ? Number(session.started_at) : session.created_at,
            model,
            provider: session.billing_provider || session.provider_name || source,
            session: String(session.id),
            input,
            output,
            cacheRead: num(session.cache_read_tokens),
            cacheWrite: num(session.cache_write_tokens),
            reasoning:
              source === "hermes"
                ? num(session.reasoning_tokens)
                : Math.max(0, (num(session.accumulated_total_tokens) || num(session.total_tokens)) - input - output),
            cost: session.actual_cost_usd ?? session.estimated_cost_usd,
            dedup: String(session.id)
          });
        }
      }
    });
  if (source === "opencode") {
    const messages = sourceRoots(source).flatMap((root) =>
      files(path.join(root, "storage", "message"), (f) => f.endsWith(".json"))
    );
    await parallel(messages, 8, (file) =>
      collector.scanFile(source, path.dirname(file), file, async (out) => {
        const entry = parseMessage(readJson(file), { source, session: basename(path.dirname(file)) });
        if (entry) out.add(entry);
      })
    );
  }
}
module.exports = { collectDatabase };
