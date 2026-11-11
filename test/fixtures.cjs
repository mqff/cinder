const fs = require("node:fs");
const path = require("node:path");
const { definitions } = require("../main/source-paths");
function fixtures(root) {
  const env = {},
    timestamp = new Date().toISOString();
  function write(relative, value, jsonl = false) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, jsonl ? value.map((v) => JSON.stringify(v)).join("\n") + "\n" : JSON.stringify(value));
    return file;
  }
  for (const [source, [, variable]] of Object.entries(definitions)) {
    env[variable] = path.join(root, source);
    fs.mkdirSync(env[variable], { recursive: true });
  }
  env.CURSOR_PROJECTS_DIR = path.join(root, "cursor", "projects");
  env.CURSOR_TRACKING_DB = path.join(root, "cursor", "tracking.db");
  env.PI_CODING_AGENT_DIR = "";
  env.CINDER_T3_HOME = path.join(root, "t3");
  env.PI_CODING_AGENT_SESSION_DIR = "";
  const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 };
  write(
    "claude/projects/app/session.jsonl",
    [
      {
        timestamp,
        cwd: "/work/app",
        sessionId: "shared",
        message: {
          id: "message",
          model: "claude-sonnet-4-20250514",
          usage,
          content: [
            { type: "tool_use", id: "tool1", name: "Read" },
            { type: "tool_use", id: "mcp1", name: "mcp__docs__search" },
            { type: "tool_use", id: "skill1", name: "Skill", input: { skill: "review" } }
          ]
        }
      },
      {
        timestamp,
        cwd: "/work/app",
        sessionId: "shared",
        message: { id: "message", model: "claude-sonnet-4-20250514", usage: { ...usage, output_tokens: 30 } }
      }
    ],
    true
  );
  write(
    "codex/sessions/session.jsonl",
    [
      { type: "session_meta", payload: { cwd: "C:\\work\\app", model: "gpt-5" } },
      ...[
        [100, 50, 20],
        [100, 50, 20],
        [140, 70, 30]
      ].map(([input, cache, output]) => ({
        timestamp,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: input, cached_input_tokens: cache, output_tokens: output } }
        }
      })),
      {
        timestamp,
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "tool2",
          name: "exec_command",
          arguments: "read /skills/review/SKILL.md"
        }
      }
    ],
    true
  );
  write("gemini/chat.json", {
    messages: [{ timestamp, model: "gemini-2.5-pro", tokens: { input: 100, cached: 40, output: 20, thoughts: 5 } }]
  });
  write(
    "qwen/projects/app/chats/chat.jsonl",
    [{ timestamp, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, cachedContentTokenCount: 40 } }],
    true
  );
  write("droid/one.settings.json", {
    providerLockTimestamp: timestamp,
    model: "gpt-5",
    tokenUsage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, thinkingTokens: 5 }
  });
  write("amp/thread.json", {
    id: "thread",
    messages: [
      {
        id: "message",
        timestamp,
        model: "gpt-5",
        usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 40 }
      }
    ]
  });
  write(
    "kimi/sessions/one/wire.jsonl",
    [{ timestamp, usage: { input_other: 100, output: 20, input_cache_read: 40 } }],
    true
  );
  write("codebuff/projects/app/chat-messages.json", [
    { timestamp, id: "message", metadata: { model: "gpt-5", usage } }
  ]);
  for (const source of ["openclaw", "pi"])
    write(
      `${source}/one.jsonl`,
      [
        {
          timestamp,
          message: {
            id: "message",
            role: "assistant",
            model: "gpt-5",
            usage: { input: 100, output: 20, cacheRead: 40 }
          }
        }
      ],
      true
    );
  const otel = write(
    "copilot/events.jsonl",
    [
      {
        timestamp,
        attributes: {
          "gen_ai.response.id": "response",
          "gen_ai.request.model": "gpt-5",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 20
        }
      }
    ],
    true
  );
  env.COPILOT_OTEL_FILE_EXPORTER_PATH = otel;
  write("grok/sessions/app/one/summary.json", { info: { cwd: "/work/app" }, current_model_id: "grok-4.6" });
  write("grok/sessions/app/one/usage.json", {
    sessionId: "one",
    updatedAt: timestamp,
    turns: [{ turnNumber: 1, inputTokens: 100, outputTokens: 20, cachedReadTokens: 40, reasoningTokens: 5 }]
  });
  write(
    "grok/sessions/app/one/updates.jsonl",
    [
      {
        timestamp: Date.now(),
        params: { update: { sessionUpdate: "tool_call", toolCallId: "grok-tool", title: "read_file" } }
      }
    ],
    true
  );
  const { DatabaseSync } = require("node:sqlite");
  function db(relative, setup) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const database = new DatabaseSync(file);
    try {
      setup(database);
    } finally {
      database.close();
    }
    return file;
  }
  for (const source of ["opencode", "kilo"])
    db(`${source}/${source}.db`, (database) => {
      database.exec(
        "CREATE TABLE session (id TEXT, directory TEXT); CREATE TABLE message (id TEXT, session_id TEXT, data TEXT); CREATE TABLE part (data TEXT, time_created INTEGER)"
      );
      database.prepare("INSERT INTO session VALUES (?, ?)").run("one", "/work/app");
      database.prepare("INSERT INTO message VALUES (?, ?, ?)").run(
        "message",
        "one",
        JSON.stringify({
          id: "message",
          role: "assistant",
          modelID: "gpt-5",
          sessionID: "one",
          time: { created: Date.now() },
          tokens: { input: 100, output: 20, cache: { read: 40 } }
        })
      );
      database
        .prepare("INSERT INTO part VALUES (?, ?)")
        .run(JSON.stringify({ type: "tool", tool: "read", callID: "opencode-tool" }), Date.now());
    });
  db("goose/sessions/sessions.db", (database) => {
    database.exec(
      "CREATE TABLE sessions (id TEXT, model_config_json TEXT, provider_name TEXT, created_at TEXT, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER)"
    );
    database
      .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("one", '{"model":"gpt-5"}', "openai", timestamp, 100, 20, 120);
  });
  db("hermes/state.db", (database) => {
    database.exec(
      "CREATE TABLE sessions (id TEXT, model TEXT, billing_provider TEXT, started_at INTEGER, input_tokens INTEGER, output_tokens INTEGER, actual_cost_usd REAL)"
    );
    database
      .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("one", "gpt-5", "openai", Date.now(), 100, 20, 0.03);
  });
  db("cursor/globalStorage/state.vscdb", (database) => {
    database.exec("CREATE TABLE cursorDiskKV (key TEXT, value TEXT)");
    database
      .prepare("INSERT INTO cursorDiskKV VALUES (?, ?)")
      .run(
        "bubbleId:one:message",
        JSON.stringify({ type: 1, createdAt: timestamp, modelInfo: { modelName: "gpt-5" } })
      );
    database.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run(
      "bubbleId:one:tool",
      JSON.stringify({
        type: 2,
        createdAt: timestamp,
        toolFormerData: { name: "read_file", modelCallId: "cursor-tool" }
      })
    );
  });
  function vint(value) {
    const bytes = [];
    do {
      const low = value % 128;
      value = Math.floor(value / 128);
      bytes.push(low + (value ? 128 : 0));
    } while (value);
    return Buffer.from(bytes);
  }
  const int = (key, value) => Buffer.concat([vint(key * 8), vint(value)]);
  const bytes = (key, value) => {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return Buffer.concat([vint(key * 8 + 2), vint(data.length), data]);
  };
  const tokens = Buffer.concat([int(1, 1), int(2, 100), int(3, 20), int(5, 40), bytes(11, "response")]);
  const time = int(1, Math.floor(Date.now() / 1000));
  const generation = bytes(1, Buffer.concat([bytes(4, tokens), bytes(19, "gemini-2.5-pro"), bytes(9, bytes(4, time))]));
  db("antigravity/conversations/one.db", (database) => {
    database.exec(
      "CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, metadata BLOB)"
    );
    database.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(0, generation);
    database.prepare("INSERT INTO steps VALUES (?, ?)").run(0, Buffer.concat([bytes(1, time), bytes(9, tokens)]));
  });
  write(
    "muse/sessions/one/session.jsonl",
    [
      {
        schema_version: 1,
        record_type: "event",
        payload_type: "runtime.session",
        payload_schema_version: 1,
        id: "muse-inference",
        recorded_at: Date.parse(timestamp) * 1000,
        stream: { kind: "session", id: "muse-session" },
        payload: {
          event: {
            kind: "model_completed",
            model: "claude-sonnet-4",
            usage: {
              input_tokens: 100,
              cached_tokens: 40,
              cache_write_tokens: 10,
              output_tokens: 20,
              reasoning_tokens: 5
            }
          }
        }
      }
    ],
    true
  );
  return { env, timestamp };
}
module.exports = { fixtures };
