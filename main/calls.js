const fs = require("node:fs");
const path = require("node:path");
const { HOME, json, files, lines, parallel, signature, toIso } = require("./io");
const { sourceFiles, sourceRoots } = require("./source-paths");
const { queryLive } = require("./sqlite");
const { writeJsonFile } = require("./jsonfile");
const cursor = require("./sources/cursor");
const grok = require("./sources/grok");
function day(time) {
  const date = new Date(time);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
function classify(name, input = {}, id, t = 0) {
  if (!input || typeof input !== "object") input = {};
  const event = { i: id, t, k: "tool", n: name };
  if (["Skill", "SlashCommand"].includes(name))
    return { ...event, k: "skill", n: input.skill || input.command || input.name || "unknown" };
  if (["CallMcpTool", "call_mcp_tool"].includes(name))
    return {
      ...event,
      k: "mcp",
      s: input.server || input.serverName || input.mcpServer || "unknown",
      n: input.toolName || input.tool || input.name || name
    };
  const raw = name.replace(/^mcp__/, "");
  const cut = raw.indexOf("__");
  if (cut > 0) return { ...event, k: "mcp", s: raw.slice(0, cut), n: raw.slice(cut + 2) };
  return event;
}
function extract(source, record, fallbackTime = 0) {
  if (source === "grok") {
    const event = grok.eventFromUpdate(record);
    return event ? [event] : [];
  }
  const iso = toIso(record.timestamp || record.message?.timestamp);
  const time = iso ? Date.parse(iso) : fallbackTime;
  const result = [];
  if (source === "codex") {
    const payload = record.payload;
    if (!payload) return result;
    if (
      ["function_call", "custom_tool_call"].includes(payload.type) &&
      typeof payload.name === "string" &&
      payload.name
    ) {
      const id = payload.call_id || payload.id;
      result.push(classify(payload.name, {}, id, time));
      const args =
        typeof payload.arguments === "string"
          ? payload.arguments
          : typeof payload.input === "string"
            ? payload.input
            : "";
      const match = args.includes("SKILL.md") && args.match(/[/\\]skills[/\\]([^/\\\s"'`]+)/);
      if (match) result.push({ i: id ? `${id}:skill` : undefined, t: time, k: "skill", n: match[1] });
    }
    const item = payload.item;
    if (payload.type === "item_completed" && item?.type === "McpToolCall")
      result.push({ i: item.id, t: time, k: "mcp", s: item.server, n: item.tool });
  } else {
    for (const block of Array.isArray(record.message?.content) ? record.message.content : []) {
      if (block?.type !== "tool_use" || typeof block.name !== "string" || !block.name) continue;
      const event = classify(block.name, block.input, block.id, time);
      if (source === "cursor" && event.k === "tool") event.n = cursor.toolName(event.n);
      result.push(event);
    }
  }
  return result;
}
function configKeys(raw, section) {
  const uncommented = raw.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (token) =>
    token.startsWith('"') ? token : ""
  );
  const withoutTrailingCommas = uncommented.replace(/"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g, (token) =>
    token.startsWith('"') ? token : ""
  );
  try {
    const block = JSON.parse(withoutTrailingCommas)[section];
    return block && typeof block === "object" && !Array.isArray(block) ? Object.keys(block) : [];
  } catch {
    return [];
  }
}
function installedInfo() {
  const skills = new Set(),
    mcp = {};
  for (const source of ["claude", "codex", "cursor", "opencode", "grok"]) {
    const names = new Set();
    const roots = [...sourceRoots(source)];
    if (source === "cursor") roots.push(path.join(HOME, ".cursor"));
    if (source === "opencode")
      roots.push(path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, ".config"), "opencode"));
    for (const root of roots) {
      if (source === "claude" || source === "codex") {
        for (const file of files(path.join(root, "skills"), (f) => path.basename(f) === "SKILL.md"))
          skills.add(path.basename(path.dirname(file)));
      }
      const configs =
        source === "claude"
          ? [path.join(root, ".claude.json"), path.join(HOME, ".claude.json")]
          : source === "cursor"
            ? [path.join(root, "mcp.json")]
            : source === "opencode"
              ? [path.join(root, "opencode.json"), path.join(root, "opencode.jsonc")]
              : [path.join(root, "config.toml")];
      for (const file of configs) {
        let raw;
        try {
          raw = fs.readFileSync(file, "utf8");
        } catch {
          continue;
        }
        if (file.endsWith(".toml")) {
          for (const match of raw.matchAll(/^\s*\[mcp_servers\.(?:"([^"]+)"|([^\].]+))\]/gm))
            names.add(match[1] || match[2].trim());
        } else for (const key of configKeys(raw, source === "opencode" ? "mcp" : "mcpServers")) names.add(key);
      }
    }
    mcp[source] = [...names].sort();
  }
  return { skills: [...skills].sort(), mcp };
}
async function collectCalls(cacheDir) {
  const cachePath = cacheDir && path.join(cacheDir, "calls-cache.json");
  const stored = cachePath ? json(cachePath, {}) : {};
  const previous = stored.v === 5 ? stored.files || {} : {};
  const next = {},
    groups = {},
    seen = new Set(),
    diagnostics = [];
  const installed = installedInfo();
  const fingerprint = (source, file) =>
    signature(file) + (source === "opencode" ? JSON.stringify(installed.mcp.opencode) : "");
  function add(source, event) {
    if (typeof event?.n !== "string" || !event.n || !["tool", "skill", "mcp"].includes(event.k)) return;
    const id = event.i == null ? null : JSON.stringify([source, event.i, event.k]);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    const group = (groups[source] ||= {
      total: 0,
      tools: new Map(),
      mcpTools: new Map(),
      skills: new Map(),
      byDay: new Map()
    });
    group.total++;
    const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
    if (event.t && Number.isFinite(new Date(event.t).getTime())) bump(group.byDay, day(event.t));
    if (event.k === "mcp") bump(group.mcpTools, JSON.stringify([event.s || "unknown", event.n]));
    else bump(event.k === "skill" ? group.skills : group.tools, event.n);
  }
  async function scan(source, file, parse) {
    let sig;
    try {
      sig = fingerprint(source, file);
    } catch (error) {
      if (error.code !== "ENOENT") diagnostics.push({ source, file, message: error.message });
      return;
    }
    try {
      const key = source + ":" + file;
      let events = previous[key]?.sig === sig ? previous[key].events : null;
      let warned = false;
      if (!Array.isArray(events))
        events = await parse((message) => {
          warned = true;
          diagnostics.push({ source, file, message });
        });
      if (!warned && fingerprint(source, file) === sig) next[key] = { sig, events };
      for (const event of events) add(source, event);
    } catch (error) {
      diagnostics.push({ source, file, message: error.message });
    }
  }
  await parallel(["claude", "codex", "cursor", "grok"], 4, async (source) => {
    const candidates =
      source === "cursor" ? cursor.transcriptFiles() : source === "grok" ? grok.updatesFiles() : sourceFiles(source);
    await parallel(candidates, 8, (file) =>
      scan(source, file, async (warn) => {
        const events = [];
        const fallbackTime = fs.statSync(file).mtimeMs;
        const keep =
          source === "grok"
            ? grok.KEEP
            : source === "codex"
              ? (line) => /function_call|custom_tool_call|McpToolCall/.test(line)
              : (line) => line.includes('"tool_use"');
        await lines(
          file,
          (record) => events.push(...extract(source, record, fallbackTime)),
          keep,
          (count) => warn(`${count} malformed call records`)
        );
        return events;
      })
    );
  });
  for (const root of sourceRoots("opencode"))
    for (const file of files(root, (f) => /^opencode(?:-[\w.-]+)?\.db$/.test(path.basename(f)))) {
      await scan("opencode", file, async (warn) => {
        const rows = await queryLive(file, "SELECT data, time_created FROM part");
        if (!rows) throw new Error("Unable to read OpenCode calls");
        let malformed = 0;
        const events = rows.flatMap((row) => {
          let part;
          try {
            part = JSON.parse(row.data);
          } catch {
            malformed++;
            return [];
          }
          if (part?.type !== "tool" || typeof part.tool !== "string" || !part.tool) return [];
          const server = [...installed.mcp.opencode]
            .sort((a, b) => b.length - a.length)
            .find((name) => part.tool.toLowerCase().startsWith(name.toLowerCase() + "_"));
          return [
            {
              i: part.callID || part.id,
              t: row.time_created,
              k: server ? "mcp" : "tool",
              s: server,
              n: server ? part.tool.slice(server.length + 1) : part.tool
            }
          ];
        });
        if (malformed) warn(`${malformed} malformed call records`);
        return events;
      });
    }
  for (const root of cursor.userDirs())
    await scan("cursor", path.join(root, "globalStorage", "state.vscdb"), async () => {
      const rows = await queryLive(path.join(root, "globalStorage", "state.vscdb"), cursor.BUBBLE_SQL);
      if (!rows) throw new Error("Unable to read Cursor tools");
      return rows
        .filter((row) => Number(row.type) === 2 && row.toolName)
        .map((row) => ({
          i: row.toolId || row.key,
          t: Date.parse(row.createdAt) || Number(row.createdAt) || 0,
          k: "tool",
          n: cursor.toolName(row.toolName)
        }));
    });
  if (cachePath)
    try {
      writeJsonFile(cachePath, { v: 5, files: next });
    } catch (error) {
      diagnostics.push({ source: "cache", message: error.message });
    }
  const rank = (map) => [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const sources = {};
  for (const [source, group] of Object.entries(groups)) {
    const servers = new Map();
    const mcpTools = [...group.mcpTools]
      .map(([key, count]) => {
        const [server, name] = JSON.parse(key);
        servers.set(server, (servers.get(server) || 0) + count);
        return { server, name, count };
      })
      .sort((a, b) => b.count - a.count);
    sources[source] = {
      total: group.total,
      tools: rank(group.tools),
      skills: rank(group.skills),
      mcpTools,
      mcpServers: rank(servers),
      byDay: Object.fromEntries([...group.byDay].sort())
    };
  }
  return { sources, installed, diagnostics, scannedAt: new Date().toISOString() };
}
module.exports = { collectCalls, extract, classify, configKeys };
