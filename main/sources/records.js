const fs = require("node:fs");
const path = require("node:path");
const { num, basename, readJson, lines, parallel } = require("../io");
const { sourceFiles } = require("../source-paths");
const pick = (obj, ...keys) => num(keys.map((k) => obj?.[k]).find((v) => v != null));
function base(source, record, file) {
  return {
    source,
    ts:
      record.timestamp ??
      record.created_at ??
      record.createdAt ??
      record.lastUpdated ??
      record.last_updated ??
      record.startTime ??
      record.start_time ??
      fs.statSync(file).mtime,
    session: record.sessionId || record.session_id || path.basename(file, path.extname(file)),
    model: record.model || source,
    provider: source,
    project: record.cwd ? basename(record.cwd) : source,
    dedup: record.id || record.messageId
  };
}
function anthropic(u = {}) {
  return {
    input: pick(u, "input_tokens", "prompt_tokens", "inputTokens"),
    output: pick(u, "output_tokens", "completion_tokens", "outputTokens"),
    cacheWrite: pick(u, "cache_creation_input_tokens", "cacheCreationInputTokens"),
    cacheRead: pick(u, "cache_read_input_tokens", "cached_tokens", "cacheReadInputTokens"),
    cacheWrite1h: num(u.cache_creation?.ephemeral_1h_input_tokens)
  };
}
function camel(u = {}) {
  return {
    input: pick(u, "input", "inputTokens"),
    output: pick(u, "output", "outputTokens"),
    cacheWrite: pick(u, "cacheWrite", "cache_write", "cacheCreationTokens", "cacheCreationInputTokens"),
    cacheRead: pick(u, "cacheRead", "cache_read", "cacheReadTokens", "cacheReadInputTokens")
  };
}
function parseRecord(source, record, file, state = {}) {
  if (source === "codex" && record.payload?.type === "thread_settings_applied") {
    const tier = record.payload.thread_settings?.service_tier;
    state.speed = tier === "priority" || tier === "fast" ? "fast" : tier === "ultrafast" ? "ultrafast" : "standard";
    state.speedRecorded = true;
    return [];
  }
  if (source === "codex" && ["session_meta", "turn_context"].includes(record.type) && record.payload) {
    state.model = record.payload.model || state.model;
    state.cwd = record.payload.cwd || state.cwd;
    if (record.type === "turn_context") state.turn = record.payload.turn_id;
    if (record.type === "session_meta") state.session = record.payload.id || state.session;
    return [];
  }
  const common = base(source, record, file);
  switch (source) {
    case "claude": {
      const message = record.message;
      if (!message?.usage) return [];
      let usage = anthropic(message.usage);
      if (
        !usage.input &&
        !usage.output &&
        !usage.cacheRead &&
        !usage.cacheWrite &&
        Array.isArray(message.usage.iterations)
      ) {
        usage = message.usage.iterations
          .filter((item) => item?.type !== "advisor_message")
          .map(anthropic)
          .reduce((sum, row) => {
            for (const key of Object.keys(row)) sum[key] = (sum[key] || 0) + row[key];
            return sum;
          }, {});
      }
      const executor = {
        ...common,
        ...usage,
        ts: record.timestamp || message.timestamp,
        model: message.model,
        provider: "anthropic",
        speed: message.usage.speed === "fast" ? "fast" : "standard",
        session: record.sessionId || common.session,
        cost: record.costUSD,
        dedup: message.id ? `${message.id}:${record.requestId || ""}` : undefined
      };
      const advisors = (Array.isArray(message.usage.iterations) ? message.usage.iterations : []).flatMap(
        (advisor, index) =>
          advisor?.type === "advisor_message" && typeof advisor.model === "string" && advisor.model
            ? [
                {
                  ...executor,
                  ...anthropic(advisor),
                  model: advisor.model,
                  cost: undefined,
                  dedup: executor.dedup ? `${executor.dedup}:advisor:${index}` : undefined
                }
              ]
            : []
      );
      return [executor, ...advisors];
    }
    case "codex": {
      const payload = record.payload;
      if (!payload) return [];
      const totals = payload.type === "token_count" && payload.info?.total_token_usage;
      if (!totals) return [];
      const next = [num(totals.input_tokens), num(totals.cached_input_tokens), num(totals.output_tokens)];
      const previous = state.totals || [0, 0, 0];
      const reset = next[0] < previous[0] || next[2] < previous[2];
      const delta = next.map((value, index) => Math.max(0, value - (reset ? 0 : previous[index])));
      state.totals = next;
      const cached = Math.min(delta[0], delta[1]);
      return [
        {
          ...common,
          model: state.model || "gpt-5",
          session: state.session || common.session,
          dedup: `${record.timestamp}:${next.join(":")}`,
          provider: "openai",
          speed: state.speed || "standard",
          speedRecorded: state.speedRecorded === true,
          nativeTurn: state.turn,
          project: state.cwd ? basename(state.cwd) : common.session,
          input: delta[0] - cached,
          cacheRead: cached,
          output: delta[2]
        }
      ];
    }
    case "gemini": {
      const usage = record.tokens || record.stats || record.result?.stats || record.usageMetadata;
      if (!usage) return [];
      const cached = pick(usage, "cached", "cached_tokens", "cachedContentTokenCount");
      return [
        {
          ...common,
          provider: "google",
          input:
            Math.max(0, pick(usage, "input", "prompt", "input_tokens", "prompt_tokens", "promptTokenCount") - cached) +
            pick(usage, "tool", "tool_tokens"),
          output: pick(usage, "output", "candidates", "output_tokens", "candidates_tokens", "candidatesTokenCount"),
          cacheRead: cached,
          reasoning: pick(usage, "thoughts", "reasoning", "thoughts_tokens", "reasoning_tokens", "thoughtsTokenCount")
        }
      ];
    }
    case "qwen": {
      const usage = record.usageMetadata || record.usage_metadata;
      if (!usage) return [];
      return [
        {
          ...common,
          project: basename(path.dirname(path.dirname(file))),
          input: Math.max(
            0,
            pick(usage, "promptTokenCount", "prompt_token_count") -
              pick(usage, "cachedContentTokenCount", "cached_content_token_count")
          ),
          output: pick(usage, "candidatesTokenCount", "candidates_token_count"),
          reasoning: pick(usage, "thoughtsTokenCount", "thoughts_token_count"),
          cacheRead: pick(usage, "cachedContentTokenCount", "cached_content_token_count")
        }
      ];
    }
    case "kimi": {
      const payload = record.message?.payload;
      const usage = payload?.token_usage || record.usage;
      if (!usage) return [];
      return [
        {
          ...common,
          session: basename(path.dirname(file)),
          model: record.model || "kimi-for-coding",
          provider: "moonshotai",
          input: pick(usage, "input_other", "inputOther"),
          output: num(usage.output),
          cacheWrite: pick(usage, "input_cache_creation", "inputCacheCreation"),
          cacheRead: pick(usage, "input_cache_read", "inputCacheRead"),
          dedup: payload?.message_id || record.message_id
        }
      ];
    }
    case "pi": {
      if (record.type === "session") {
        state.session = record.id;
        return [];
      }
      const message = record.message || record;
      if (!message.usage || (message.role && !["assistant", "toolResult"].includes(message.role))) return [];
      const auxiliary = message.role === "toolResult" || ["compaction", "branch_summary"].includes(record.type);
      const model = auxiliary
        ? "Tools/summaries"
        : message.responseModel || message.modelId || message.model || state.model || source;
      const provider = message.provider || record.provider || source;
      const cost = message.usage.cost?.total;
      return [
        {
          ...common,
          ...camel(message.usage),
          model,
          provider,
          session: state.session || common.session,
          reasoning: Math.min(num(message.usage.reasoning), num(message.usage.output)),
          reasoningIncluded: true,
          cost: Number.isFinite(cost) && cost > 0 ? cost : undefined,
          allowEmpty: Number.isFinite(cost) && cost > 0,
          dedup:
            record.id || message.id
              ? JSON.stringify([record.id || message.id, record.timestamp, provider, model])
              : undefined,
          dedupGlobal: true
        }
      ];
    }
    case "openclaw": {
      state.model = record.data?.modelId || record.data?.model || record.modelId || record.model || state.model;
      const message = record.message || record;
      if (!message.usage || (message.role && message.role !== "assistant")) return [];
      return [
        {
          ...common,
          ...camel(message.usage),
          ts: message.timestamp || common.ts,
          model: message.modelId || message.model || state.model || source,
          dedup: message.id
        }
      ];
    }
    case "muse": {
      const event = record.payload?.event,
        usage = event?.usage;
      if (
        record.schema_version !== 1 ||
        record.record_type !== "event" ||
        record.payload_type !== "runtime.session" ||
        ![1, 3].includes(record.payload_schema_version) ||
        !["model_completed", "automated_review_completed"].includes(event?.kind) ||
        record.stream?.kind !== "session" ||
        typeof record.stream.id !== "string" ||
        typeof record.id !== "string" ||
        !Number.isSafeInteger(record.recorded_at) ||
        record.recorded_at <= 0 ||
        !usage
      )
        return [];
      const model = typeof event.model === "string" ? event.model : event.model?.model_id;
      if (typeof model !== "string" || !model) return [];
      const input = num(usage.input_tokens),
        output = num(usage.output_tokens);
      const cacheRead = Math.min(
        input,
        num(usage.cache_read_tokens ?? usage.cached_input_tokens ?? usage.cached_tokens)
      );
      const cacheWrite = Math.min(input - cacheRead, num(usage.cache_write_tokens));
      return [
        {
          ...common,
          model,
          ts: record.recorded_at / 1000,
          session: record.stream.id,
          input: input - cacheRead - cacheWrite,
          output,
          cacheRead,
          cacheWrite,
          reasoning: Math.min(output, num(usage.reasoning_tokens)),
          reasoningIncluded: true,
          dedup: record.payload.source_run_record_id || record.id,
          dedupGlobal: true
        }
      ];
    }
    case "droid": {
      if (!record.tokenUsage) return [];
      return [
        {
          ...common,
          ...camel(record.tokenUsage),
          ts: record.providerLockTimestamp || common.ts,
          session: path.basename(file).replace(/\.settings\.json$/, ""),
          model: record.model || record.providerLock || "droid",
          provider: record.providerLock || "droid",
          reasoning: num(record.tokenUsage.thinkingTokens)
        }
      ];
    }
    case "codebuff": {
      const metadata = record.metadata || record;
      const usage = metadata.usage || metadata.codebuff?.usage || record.usage;
      return usage
        ? [
            {
              ...common,
              ...anthropic(usage),
              model: metadata.model || "codebuff",
              session: basename(path.dirname(file)),
              project: basename(path.dirname(file))
            }
          ]
        : [];
    }
    case "amp": {
      if (!Array.isArray(record.messages)) return [];
      const ledger = record.usage_ledger?.events;
      const messages = new Map(record.messages.map((m) => [String(m.message_id || m.messageId || m.id), m]));
      return (Array.isArray(ledger) ? ledger : record.messages).flatMap((event) => {
        const usage = ledger ? event.tokens : event.usage;
        if (!usage) return [];
        const message = ledger ? messages.get(String(event.to_message_id || event.toMessageId)) : event;
        return [
          {
            ...base(source, event, file),
            ...camel(usage),
            session: String(record.id),
            model: event.model || "amp",
            cacheWrite: num(message?.usage?.cacheCreationInputTokens),
            cacheRead: num(message?.usage?.cacheReadInputTokens),
            dedup: event.id || event.message_id || event.messageId
          }
        ];
      });
    }
    default:
      return [];
  }
}
async function collectRecords(source, collector) {
  const filters = {
    claude: (line) => line.includes('"usage"'),
    codex: (line) => /"(?:token_count|turn_context|session_meta|thread_settings_applied)"/.test(line),
    qwen: (line) => line.includes("usageMetadata") || line.includes("usage_metadata"),
    pi: (line) => line.includes('"usage"') || line.includes('"session"'),
    muse: (line) => line.includes('"model_completed"') || line.includes('"automated_review_completed"'),
    kimi: (line) => line.includes("token_usage") || line.includes('"usage"'),
    openclaw: (line) => line.includes('"usage"') || line.includes('"model"') || line.includes('"modelId"')
  };
  const jsonSource = ["droid", "amp", "codebuff"].includes(source);
  const candidates = sourceFiles(source, jsonSource ? ".json" : ".jsonl");
  if (source === "gemini") candidates.push(...sourceFiles(source, ".json"));
  const selected = candidates.filter((file) =>
    source === "muse"
      ? basename(file) === "session.jsonl"
      : source === "droid"
        ? file.endsWith(".settings.json")
        : source === "codebuff"
          ? basename(file) === "chat-messages.json"
          : source === "kimi"
            ? basename(file) === "wire.jsonl"
            : source === "qwen"
              ? basename(path.dirname(file)) === "chats"
              : true
  );
  await parallel(selected, 8, (file) =>
    collector.scanFile(source, path.dirname(file), file, async (out) => {
      const state = {};
      const emit = (record) => {
        for (const entry of parseRecord(source, record, file, state)) out.add(entry);
        if (source === "gemini" && Array.isArray(record.messages)) for (const message of record.messages) emit(message);
      };
      if (file.endsWith(".jsonl"))
        await lines(file, emit, filters[source], (count) => out.warn(`${count} malformed usage records`));
      else {
        const document = readJson(file);
        if (document)
          for (const record of Array.isArray(document)
            ? document
            : source === "codebuff" && Array.isArray(document.messages)
              ? document.messages
              : [document])
            emit(record);
      }
    })
  );
}
module.exports = { parseRecord, collectRecords };
