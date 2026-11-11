const path = require("node:path");
const { sourceRoots } = require("../source-paths");
const { files, basename } = require("../io");
const { queryLive } = require("../sqlite");
const { hasRate } = require("../pricing");
function fields(bytes) {
  const output = [];
  let offset = 0;
  function integer() {
    let result = 0,
      factor = 1;
    for (let n = 0; n < 10 && offset < bytes.length; n++) {
      const byte = bytes[offset++];
      result += (byte & 127) * factor;
      if (byte < 128) return result;
      factor *= 128;
    }
    throw new Error("Truncated protobuf integer");
  }
  try {
    while (offset < bytes.length) {
      const tag = integer(),
        number = Math.floor(tag / 8),
        wire = tag & 7;
      if (!number) break;
      if (wire === 0) output.push({ number, value: integer() });
      else {
        const size = wire === 2 ? integer() : wire === 1 ? 8 : wire === 5 ? 4 : -1;
        if (size < 0 || offset + size > bytes.length) break;
        output.push({ number, bytes: bytes.subarray(offset, offset + size) });
        offset += size;
      }
    }
  } catch {}
  return output;
}
const text = (bytes) => bytes?.toString("utf8").trim();
function time(bytes) {
  const values = new Map(fields(bytes || Buffer.alloc(0)).map((f) => [f.number, f.value]));
  return values.get(1) ? values.get(1) * 1000 + Math.floor((values.get(2) || 0) / 1e6) : null;
}
function usage(bytes) {
  const values = new Map(fields(bytes).map((f) => [f.number, f]));
  const value = (n) => values.get(n)?.value || 0;
  return {
    modelId: value(1),
    input: value(2),
    output: value(3) || value(9) + value(10),
    cacheWrite: value(4),
    cacheRead: value(5),
    identity: text(values.get(11)?.bytes) || text(values.get(12)?.bytes) || text(values.get(7)?.bytes)
  };
}
function decode(bytes, generation = false) {
  const record = { ts: null, model: null, usages: [] };
  for (const field of fields(bytes)) {
    if (!field.bytes) continue;
    if (field.number === (generation ? 4 : 9)) record.usages.push(usage(field.bytes));
    if (field.number === (generation ? 17 : 28)) {
      const inner = fields(field.bytes).find((f) => f.number === 2 && f.bytes);
      if (inner) record.usages.push(usage(inner.bytes));
    }
    if (!generation && [1, 32].includes(field.number)) record.ts ||= time(field.bytes);
    if (generation && field.number === 19) record.model = text(field.bytes);
    if (generation && field.number === 9) {
      const timestamp = fields(field.bytes).find((f) => f.number === 4 && f.bytes);
      if (timestamp) record.ts = time(timestamp.bytes);
    }
  }
  return record;
}
async function collect(collector) {
  const databases = sourceRoots("antigravity").flatMap((root) =>
    files(path.join(root, "conversations"), (f) => f.endsWith(".db"))
  );
  for (const file of databases)
    await collector.scanFile("antigravity", path.dirname(file), file, async (out) => {
      const generations = await queryLive(
        file,
        "SELECT hex(data) AS d FROM gen_metadata WHERE data IS NOT NULL ORDER BY idx"
      );
      const steps = await queryLive(
        file,
        "SELECT hex(metadata) AS m FROM steps WHERE metadata IS NOT NULL ORDER BY idx"
      );
      if (!generations && !steps) throw new Error("Unable to read Antigravity database");
      const records = [],
        models = new Map();
      for (const row of generations || [])
        for (const field of fields(Buffer.from(row.d, "hex"))) {
          if (!field.bytes) continue;
          const record = decode(field.bytes, true);
          if (!record.model) continue;
          for (const tokens of record.usages) if (tokens.identity) models.set(tokens.identity, record.model);
          records.push(record);
        }
      for (const row of steps || []) records.push(decode(Buffer.from(row.m, "hex")));
      for (const record of records)
        for (const tokens of record.usages) {
          let model = models.get(tokens.identity) || record.model || `antigravity-model-${tokens.modelId}`;
          const provider = /^claude/.test(model)
            ? "anthropic"
            : /^gemini|^gemma/.test(model)
              ? "gemini"
              : /^gpt|^o[134]/.test(model)
                ? "openai"
                : "antigravity";
          if (!hasRate(model, provider)) {
            let candidate = model;
            while (/-(a|b|low|medium|high|default)$/.test(candidate)) {
              candidate = candidate.replace(/-(a|b|low|medium|high|default)$/, "");
              if (hasRate(candidate, provider)) {
                model = candidate;
                break;
              }
            }
          }
          out.add({
            ...tokens,
            source: "antigravity",
            provider,
            model,
            ts: record.ts,
            session: basename(file).replace(/\.db$/, ""),
            dedup: tokens.identity
          });
        }
    });
}
module.exports = { id: "antigravity", label: "Antigravity", collect, fields, decode };
