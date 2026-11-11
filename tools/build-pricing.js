const fs = require("node:fs");
const path = require("node:path");

const LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MODELSDEV_URL = "https://models.dev/api.json";
const OUT = path.join(__dirname, "..", "pricing-data.json");

const M = 1e6;

const RANK = [
  [/^(anthropic|openai|gemini|google|vertex_ai|xai|deepseek|moonshot|mistral|cohere|groq)$/, 0],
  [/^(zhipu|z-ai|alibaba|qwen|dashscope|meta|meta-llama|perplexity|ai21|nvidia)$/, 1],
  [/^(bedrock|bedrock_converse|azure|azure_ai|vertex_ai-.*|amazon-bedrock|google-vertex.*)$/, 3],
  [/^(openrouter|together_ai|fireworks_ai|deepinfra|novita|nebius|hyperbolic)$/, 5]
];
const AGGREGATOR_RANK = 7;
const DERIVED_PENALTY = 2;

const norm = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();

function rankOf(provider) {
  const p = norm(provider);
  for (const [re, r] of RANK) if (re.test(p)) return r;
  return AGGREGATOR_RANK;
}

function bareOf(id) {
  const parts = String(id).split("/");
  return parts.length > 1 ? parts[parts.length - 1] : String(id);
}

function round(n) {
  if (!isFinite(n) || n === 0) return 0;
  return Number(n.toPrecision(10));
}

function expand(id) {
  const out = [id];
  const dotted = id.replace(/-(\d+)-(\d+)\b/g, "-$1.$2");
  if (dotted !== id) out.push(dotted);
  for (const v of [...out]) {
    const undated = v.replace(/[-@](\d{8}|\d{4}-\d{2}-\d{2})$/, "");
    if (undated !== v && undated.length > 3) out.push(undated);
  }
  return out;
}

function anthropicish(id, provider) {
  return /claude|anthropic/i.test(id) || /anthropic/i.test(String(provider || ""));
}

function makeRate(id, provider, { input, output, cacheWrite, cacheRead, cacheWrite1h }) {
  if (typeof input !== "number" || !isFinite(input)) return null;
  const rate = {
    in: round(input),
    out: round(typeof output === "number" && isFinite(output) ? output : 0),
    ...(typeof cacheRead === "number" ? { cr: round(cacheRead) } : {}),
    ...(typeof cacheWrite === "number" ? { cw: round(cacheWrite) } : {})
  };
  if (anthropicish(id, provider) && rate.in > 0) {
    if (cacheWrite == null) rate.cw = round(rate.in * 1.25);
    if (cacheRead == null) rate.cr = round(rate.in * 0.1);
    rate.cw1h = round(cacheWrite1h ?? rate.in * 2);
  } else if (cacheWrite1h !== undefined) {
    rate.cw1h = round(cacheWrite1h);
  }
  return rate;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { "user-agent": "cinder-pricing-build" }
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function fromLiteLLM(data) {
  const rows = [];
  for (const [key, m] of Object.entries(data)) {
    if (key === "sample_spec" || !m || typeof m !== "object") continue;
    if (typeof m.input_cost_per_token !== "number") continue;

    const provider = m.litellm_provider || (key.includes("/") ? key.split("/")[0] : "");
    const rate = makeRate(key, provider, {
      input: m.input_cost_per_token * M,
      output: (m.output_cost_per_token || 0) * M,
      cacheWrite: m.cache_creation_input_token_cost == null ? undefined : m.cache_creation_input_token_cost * M,
      cacheRead: m.cache_read_input_token_cost == null ? undefined : m.cache_read_input_token_cost * M,
      cacheWrite1h:
        m.cache_creation_input_token_cost_above_1hr == null
          ? undefined
          : m.cache_creation_input_token_cost_above_1hr * M
    });
    if (!rate) continue;
    for (const [speed, suffix] of [
      ["fast", "_priority"],
      ["ultrafast", "_ultrafast"]
    ]) {
      const multiple = speed === "fast" ? m.provider_specific_entry?.fast : undefined;
      if (Number.isFinite(multiple) && multiple > 0)
        rate[speed] = Object.fromEntries(
          Object.entries(rate)
            .filter(([, value]) => typeof value === "number")
            .map(([key, value]) => [key, round(value * multiple)])
        );
      else if (
        Number.isFinite(m[`input_cost_per_token${suffix}`]) &&
        Number.isFinite(m[`output_cost_per_token${suffix}`])
      ) {
        const input = m[`input_cost_per_token${suffix}`] * M;
        const tier = { in: round(input), out: round(m[`output_cost_per_token${suffix}`] * M) };
        for (const [key, field] of [
          ["cr", "cache_read_input_token_cost"],
          ["cw", "cache_creation_input_token_cost"],
          ["cw1h", "cache_creation_input_token_cost_above_1hr"]
        ]) {
          const explicit = m[`${field}${suffix}`];
          if (Number.isFinite(explicit)) tier[key] = round(explicit * M);
          else if (Number.isFinite(rate[key])) tier[key] = round(rate.in > 0 ? (rate[key] * input) / rate.in : input);
        }
        rate[speed] = tier;
      }
    }

    const scoped = key.includes("/");
    const model = scoped ? key.slice(key.indexOf("/") + 1) : key;
    const base = rankOf(provider);
    const derived = scoped ? base + DERIVED_PENALTY : base;

    const aliases = [];
    expand(key).forEach((a, i) => aliases.push({ alias: a, rank: base, exact: i === 0 }));
    expand(model).forEach((a, i) => aliases.push({ alias: a, rank: derived, exact: i === 0 }));
    expand(bareOf(key)).forEach((a, i) => aliases.push({ alias: a, rank: derived, exact: i === 0 }));

    rows.push({ key, provider, rate, aliases });
  }
  return rows;
}

function fromModelsDev(data) {
  const rows = [];
  for (const [provider, p] of Object.entries(data)) {
    if (!p || !p.models) continue;
    for (const [id, m] of Object.entries(p.models)) {
      const c = m && m.cost;
      if (!c || typeof c.input !== "number") continue;

      const rate = makeRate(id, provider, {
        input: c.input,
        output: c.output,
        cacheWrite: c.cache_write,
        cacheRead: c.cache_read
      });
      if (!rate) continue;

      const base = rankOf(provider);
      const aliases = [];
      expand(id).forEach((a, i) => aliases.push({ alias: a, rank: base, exact: i === 0 }));
      expand(bareOf(id)).forEach((a, i) => aliases.push({ alias: a, rank: base, exact: i === 0 }));

      rows.push({ key: `${provider}/${id}`, provider, rate, aliases });
    }
  }
  return rows;
}

function pick(proposals) {
  return (
    [...proposals].sort(
      (a, b) => a.tier - b.tier || a.rank - b.rank || Number(b.exact) - Number(a.exact) || a.key.localeCompare(b.key)
    )[0]?.rate || null
  );
}

function build(litellm, modelsdev) {
  const feeds = [
    { tier: 0, rows: fromLiteLLM(litellm) },
    { tier: 1, rows: fromModelsDev(modelsdev) }
  ];

  const flatProposals = new Map();
  const qualProposals = new Map();

  for (const { tier, rows } of feeds) {
    for (const row of rows) {
      const seen = new Set();
      for (const { alias, rank, exact } of row.aliases) {
        const a = norm(alias);
        if (!a || seen.has(a)) continue;
        seen.add(a);

        const proposal = { tier, rank, exact, key: row.key, rate: row.rate };

        if (!flatProposals.has(a)) flatProposals.set(a, []);
        flatProposals.get(a).push(proposal);

        if (row.provider) {
          const q = norm(row.provider) + "/" + a;
          if (!qualProposals.has(q)) qualProposals.set(q, []);
          qualProposals.get(q).push(proposal);
        }
      }
    }
  }

  const flat = {};
  for (const [alias, proposals] of flatProposals) {
    const rate = pick(proposals);
    if (rate) flat[alias] = rate;
  }

  const qualified = {};
  for (const [q, proposals] of qualProposals) {
    const rate = pick(proposals);
    if (rate) qualified[q] = rate;
  }

  return { flat, qualified };
}

function validate(data) {
  const problems = [];
  for (const group of ["flat", "qualified"]) {
    if (!Object.keys(data[group] || {}).length) problems.push(`empty ${group} pricing map`);
    for (const [model, rate] of Object.entries(data[group] || {})) {
      for (const [field, value] of Object.entries(rate)) {
        if (field === "dated") continue;
        if (["fast", "ultrafast"].includes(field)) {
          if (
            !value ||
            !Number.isFinite(value.in) ||
            !Number.isFinite(value.out) ||
            Object.values(value).some((amount) => !Number.isFinite(amount) || amount < 0)
          )
            problems.push(`${group}.${model}.${field} has invalid tier rates`);
          continue;
        }
        if (!Number.isFinite(value) || value < 0)
          problems.push(`${group}.${model}.${field} must be finite and nonnegative`);
      }
      if (!Number.isFinite(rate.in) || !Number.isFinite(rate.out))
        problems.push(`${group}.${model} is missing input/output rates`);
    }
  }
  return problems;
}

async function main() {
  process.stdout.write("fetching LiteLLM + models.dev ...\n");
  const [litellm, modelsdev] = await Promise.all([fetchJson(LITELLM_URL), fetchJson(MODELSDEV_URL)]);

  const data = build(litellm, modelsdev);

  const problems = validate(data);
  if (problems.length) {
    process.stderr.write("refusing to write, validation failed:\n");
    for (const p of problems.slice(0, 30)) process.stderr.write("  " + p + "\n");
    if (problems.length > 30) process.stderr.write(`  ... ${problems.length - 30} more\n`);
    process.exit(1);
  }

  writeOut(data);
}

function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stable(v[k]))
      .join(",") +
    "}"
  );
}

function intern(data) {
  const rates = [];
  const index = new Map();
  const idx = (rate) => {
    const s = stable(rate);
    if (index.has(s)) return index.get(s);
    const i = rates.length;
    index.set(s, i);
    rates.push(rate);
    return i;
  };
  const pack = (src) => {
    const out = {};
    for (const k of Object.keys(src).sort()) out[k] = idx(src[k]);
    return out;
  };
  return { rates, flat: pack(data.flat), qualified: pack(data.qualified) };
}

function inflate(raw) {
  if (!raw || typeof raw !== "object") return { flat: {}, qualified: {} };
  if (!Array.isArray(raw.rates)) {
    return { flat: raw.flat || {}, qualified: raw.qualified || {} };
  }
  const expand = (map) => {
    const out = {};
    for (const [k, i] of Object.entries(map || {})) {
      const r = typeof i === "number" ? raw.rates[i] : i;
      if (r) out[k] = r;
    }
    return out;
  };
  return { flat: expand(raw.flat), qualified: expand(raw.qualified) };
}

function writeOut(data) {
  const packed = intern(data);
  fs.writeFileSync(OUT, JSON.stringify(packed, null, 2) + "\n");
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  process.stdout.write(
    `wrote pricing-data.json — ${Object.keys(data.flat).length} aliases, ` +
      `${Object.keys(data.qualified).length} provider-scoped, ${packed.rates.length} unique rates, ${kb} KB\n`
  );
}

if (require.main === module && process.argv.includes("--repack")) {
  const raw = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const data = inflate(raw);
  const problems = validate(data);
  if (problems.length) {
    process.stderr.write("refusing to write, validation failed:\n");
    for (const p of problems.slice(0, 30)) process.stderr.write("  " + p + "\n");
    process.exit(1);
  }
  writeOut(data);
} else if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(String((err && err.stack) || err) + "\n");
    process.exit(1);
  });
}

module.exports = { build, validate, intern, inflate };
