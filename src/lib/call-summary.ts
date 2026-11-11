import type { CallsResult } from "./types.ts";
import { blank } from "./aggregate.ts";

export function summarizeCalls(calls: CallsResult | null, source: string) {
  const tools = new Map<string, number>(),
    skills = new Map<string, number>();
  const servers = new Map<string, number>(),
    mcpTools = new Map<string, number>();
  const byDay = new Map<string, ReturnType<typeof blank>>();
  let total = 0;
  const merge = (map: Map<string, number>, rows: { name: string; count: number }[]) => {
    for (const row of rows) map.set(row.name, (map.get(row.name) || 0) + row.count);
  };
  for (const [name, stats] of Object.entries(calls?.sources || {})) {
    if (source && source !== name) continue;
    total += stats.total;
    merge(tools, stats.tools);
    merge(skills, stats.skills);
    merge(servers, stats.mcpServers);
    for (const tool of stats.mcpTools) {
      const key = `${tool.server} / ${tool.name}`;
      mcpTools.set(key, (mcpTools.get(key) || 0) + tool.count);
    }
    for (const [day, count] of Object.entries(stats.byDay)) {
      if (!byDay.has(day)) byDay.set(day, blank());
      byDay.get(day)!.requests += count;
    }
  }
  const rows = (map: Map<string, number>) =>
    [...map]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { total, tools: rows(tools), skills: rows(skills), servers: rows(servers), mcpTools: rows(mcpTools), byDay };
}
