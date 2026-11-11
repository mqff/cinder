const path = require("node:path");
const { HOME, envDirs, files, basename } = require("../io");
const { sourceRoots } = require("../source-paths");
const { queryLive } = require("../sqlite");
const BUBBLE_SQL =
  "SELECT key, json_extract(value,'$.type') AS type, json_extract(value,'$.createdAt') AS createdAt, json_extract(value,'$.modelInfo.modelName') AS model, json_extract(value,'$.toolFormerData.name') AS toolName, json_extract(value,'$.toolFormerData.modelCallId') AS toolId FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'";
const projectRoot = () => process.env.CURSOR_PROJECTS_DIR || path.join(HOME, ".cursor", "projects");
function transcriptFiles() {
  return files(projectRoot(), (f) => f.endsWith(".jsonl") && /[\\/]agent-transcripts[\\/]/.test(f));
}
const aliases = {
  glob_file_search: "Glob",
  ripgrep_raw_search: "Grep",
  read_file_v2: "Read",
  read_file: "Read",
  edit_file_v2: "StrReplace",
  run_terminal_command_v2: "Shell",
  todo_write: "TodoWrite",
  read_lints: "ReadLints",
  task_v2: "Task",
  ask_question: "AskQuestion",
  create_plan: "CreatePlan",
  switch_mode: "SwitchMode",
  update_current_step: "UpdateCurrentStep",
  semantic_search_full: "SemanticSearch",
  await: "Await",
  rg: "Grep",
  ReadFile: "Read"
};
async function collect(collector) {
  const projects = new Map();
  for (const file of transcriptFiles()) {
    const relative = path.relative(projectRoot(), file).split(path.sep);
    const project = relative[0]
      .split("-")
      .filter(Boolean)
      .filter((p) => !/^[a-f0-9]{8,}$/i.test(p))
      .pop();
    const index = relative.indexOf("agent-transcripts");
    if (relative[index + 1]) projects.set(relative[index + 1].replace(/\.jsonl$/, ""), project);
  }
  const tracking = envDirs("CURSOR_TRACKING_DB");
  const trackingFiles = tracking.length
    ? tracking.map((p) => (p.endsWith(".db") ? p : path.join(p, "ai-code-tracking.db")))
    : [path.join(HOME, ".cursor", "ai-tracking", "ai-code-tracking.db")];
  function emit(out, fields) {
    out.add({
      source: "cursor",
      provider: "cursor",
      allowEmpty: true,
      input: 0,
      output: 0,
      ...fields,
      model: fields.model && fields.model !== "default" ? fields.model : "cursor-auto",
      project: projects.get(fields.session) || fields.project || "cursor"
    });
  }
  for (const file of trackingFiles)
    await collector.scanFile("cursor", path.dirname(file), file, async (out) => {
      const rows = await queryLive(
        file,
        "SELECT requestId AS id, MAX(conversationId) AS session, MAX(model) AS model, MIN(createdAt) AS ts FROM ai_code_hashes WHERE requestId IS NOT NULL AND TRIM(requestId) != '' GROUP BY requestId"
      );
      if (!rows) throw new Error("Unable to read Cursor request history");
      for (const row of rows) emit(out, { ...row, session: row.session || String(row.id), dedup: `req:${row.id}` });
    });
  for (const root of sourceRoots("cursor")) {
    const file = path.join(root, "globalStorage", "state.vscdb");
    await collector.scanFile("cursor", root, file, async (out) => {
      const rows = await queryLive(file, BUBBLE_SQL);
      const conversations = await queryLive(
        file,
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'"
      );
      if (!rows && !conversations) throw new Error("Unable to read Cursor conversation history");
      const populated = new Set();
      for (const row of rows || []) {
        if (Number(row.type) !== 1) continue;
        const session = row.key.slice(9).split(":")[0];
        populated.add(session);
        emit(out, { ts: row.createdAt, model: row.model, session, dedup: `bubble:${row.key}` });
      }
      for (const row of conversations || []) {
        let record;
        try {
          record = JSON.parse(row.value);
        } catch {
          continue;
        }
        const session = row.key.slice(13);
        if (record.isDraft || populated.has(session)) continue;
        emit(out, {
          ts: record.createdAt,
          model: record.modelConfig?.modelName,
          session,
          project: record.name,
          dedup: `composer:${session}`
        });
      }
    });
  }
}
module.exports = {
  id: "cursor",
  label: "Cursor",
  collect,
  BUBBLE_SQL,
  transcriptFiles,
  userDirs: () => sourceRoots("cursor"),
  toolName: (value) => aliases[value] || aliases[String(value).toLowerCase()] || String(value || "")
};
