const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { queryLive } = require("./sqlite");

async function readT3Tiers(query = queryLive, home = process.env.CINDER_T3_HOME || path.join(os.homedir(), ".t3")) {
  const file = path.join(home, "userdata", "statev2.sqlite");
  if (!fs.existsSync(file)) return new Map();
  const rows = await query(
    file,
    `SELECT
    json_extract(attempt.payload_json, '$.nativeThreadId') AS session,
    json_extract(turn.payload_json, '$.nativeTurnRef.nativeId') AS turn,
    (SELECT json_extract(event.payload_json, '$.modelSelection')
      FROM orchestration_events event
      WHERE event.stream_id = attempt.thread_id AND event.aggregate_kind = 'thread'
        AND event.application_event_version = 2 AND event.event_type = 'run.updated'
        AND json_extract(event.payload_json, '$.id') = attempt.run_id
        AND json_extract(event.payload_json, '$.activeAttemptId') = attempt.attempt_id
        AND json_extract(event.payload_json, '$.status') = 'running'
      ORDER BY event.sequence LIMIT 1) AS selection
    FROM orchestration_v2_projection_provider_turns turn
    JOIN orchestration_v2_projection_run_attempts attempt
      ON attempt.attempt_id = turn.run_attempt_id AND attempt.thread_id = turn.thread_id
        AND attempt.provider_thread_id = turn.provider_thread_id
    WHERE json_extract(turn.payload_json, '$.nativeTurnRef.driver') = 'codex'`
  );
  const result = new Map();
  for (const row of rows || []) {
    if (typeof row.session !== "string" || typeof row.turn !== "string") continue;
    let selection;
    try {
      selection = JSON.parse(row.selection);
    } catch {
      continue;
    }
    if (typeof selection?.model !== "string") continue;
    const option = Array.isArray(selection.options)
      ? selection.options.find((item) => item?.id === "serviceTier")
      : undefined;
    const tier = option?.value;
    if (
      (option && typeof tier !== "string") ||
      (tier !== undefined && !["default", "standard", "priority", "fast", "ultrafast"].includes(tier))
    )
      continue;
    const key = JSON.stringify([row.session, row.turn, selection.model]);
    result.set(
      key,
      result.has(key)
        ? null
        : tier === "priority" || tier === "fast"
          ? "fast"
          : tier === "ultrafast"
            ? "ultrafast"
            : "standard"
    );
  }
  return result;
}
module.exports = { readT3Tiers };
