import type { Entry, Totals, Summary, Bucket, DayPoint, UsageSelection, UsageFacets } from "./types.ts";
import { fmt } from "./format.ts";
export const blank = (): Totals => ({
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  tokens: 0,
  requests: 0,
  cost: 0
});
function shiftDay(date: Date, offset: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + offset);
  return next;
}
function addTotal(total: Totals, entry: Entry) {
  for (const key of ["input", "output", "cacheWrite", "cacheRead", "cost"] as const) total[key] += entry[key] || 0;
  total.tokens += entry.input + entry.output + entry.cacheWrite + entry.cacheRead;
  total.requests += entry.n ?? 1;
  total.unpriced = (total.unpriced || 0) + (entry.unpriced || 0);
  total.cacheSavings = (total.cacheSavings || 0) + (entry.cacheSavings || 0);
  total.speedPremium = (total.speedPremium || 0) + (entry.speedPremium || 0);
}
export function totalsOf(entries: Entry[]): Totals {
  const total = blank();
  for (const entry of entries) if (Number.isFinite(entry.t)) addTotal(total, entry);
  return total;
}
export function queryUsage(entries: Entry[], days: number, selection: UsageSelection, now = new Date()) {
  const start = shiftDay(now, 1 - days);
  start.setHours(0, 0, 0, 0);
  const from = days ? start.getTime() : -Infinity;
  const until = days ? now.getTime() : Infinity;
  const matches: Entry[] = [];
  const counts = {
    source: new Map<string, number>(),
    model: new Map<string, number>(),
    project: new Map<string, number>()
  };
  const count = (key: keyof UsageSelection, entry: Entry) =>
    counts[key].set(entry[key], (counts[key].get(entry[key]) || 0) + (entry.n ?? 1));
  for (const entry of entries) {
    if (!Number.isFinite(entry.t) || entry.t < from || entry.t > until) continue;
    const source = !selection.source || entry.source === selection.source;
    const model = !selection.model || entry.model === selection.model;
    const project = !selection.project || entry.project === selection.project;
    if (model && project) count("source", entry);
    if (source && project) count("model", entry);
    if (source && model) count("project", entry);
    if (source && model && project) matches.push(entry);
  }
  const facet = (key: keyof UsageSelection) => {
    if (selection[key] && !counts[key].has(selection[key])) counts[key].set(selection[key], 0);
    return [...counts[key]]
      .map(([name, requests]) => ({ name, requests }))
      .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));
  };
  const facets: UsageFacets = { source: facet("source"), model: facet("model"), project: facet("project") };
  return { entries: matches.length === entries.length ? entries : matches, facets };
}
export function summarize(entries: Entry[]): Summary {
  const totals = blank(),
    costBy = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const byDay = new Map<string, Totals>(),
    models = new Map<string, Bucket>(),
    projects = new Map<string, Bucket>(),
    sources = new Map<string, Bucket>();
  const byHour = Array.from({ length: 24 }, blank);
  const sessions = new Set<string>();
  let first: number | null = null,
    last: number | null = null;
  const group = (map: Map<string, Bucket>, key: string, entry: Entry) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { ...blank(), name: key, source: entry.source };
      map.set(key, bucket);
    }
    addTotal(bucket, entry);
  };
  for (const entry of entries) {
    if (!Number.isFinite(entry.t)) continue;
    addTotal(totals, entry);
    costBy.input += entry.costInput || 0;
    costBy.output += entry.costOutput || 0;
    costBy.cacheWrite += entry.costCacheWrite || 0;
    costBy.cacheRead += entry.costCacheRead || 0;
    const date = new Date(entry.t),
      key = fmt.dayKey(date);
    if (!byDay.has(key)) byDay.set(key, blank());
    addTotal(byDay.get(key)!, entry);
    group(models, entry.model, entry);
    group(projects, entry.project, entry);
    group(sources, entry.source, entry);
    addTotal(byHour[date.getHours()], entry);
    sessions.add(JSON.stringify([entry.source, entry.session]));
    first = first === null ? entry.t : Math.min(first, entry.t);
    last = last === null ? entry.t : Math.max(last, entry.t);
  }
  const sorted = (map: Map<string, Bucket>) =>
    [...map.values()].sort((a, b) => b.tokens - a.tokens || b.requests - a.requests);
  return {
    totals,
    costBy,
    byDay,
    byHour,
    models: sorted(models),
    projects: sorted(projects),
    sources: sorted(sources),
    sessions: sessions.size,
    activeDays: byDay.size,
    first,
    last,
    count: totals.requests
  };
}
export function daySeries(byDay: Map<string, Totals>, days: number, now = new Date()): DayPoint[] {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const earliest = [...byDay.keys()].sort()[0];
  const start = days ? shiftDay(end, 1 - days) : earliest ? new Date(earliest + "T00:00:00") : end;
  const result: DayPoint[] = [];
  for (let date = new Date(start); date <= end; date = shiftDay(date, 1)) {
    const key = fmt.dayKey(date);
    result.push({ ...blank(), ...byDay.get(key), key });
  }
  return result;
}
export function hourSeries(byHour: Totals[]): DayPoint[] {
  return byHour.map((total, hour) => ({ ...total, key: `${String(hour).padStart(2, "0")}:00` }));
}
export function streaks(byDay: Map<string, Totals>, now = new Date()) {
  const keys = [...byDay.keys()].sort();
  const dates = new Set(keys);
  let longest = 0,
    length = 0,
    previous = "";
  for (const key of keys) {
    length = previous === fmt.dayKey(shiftDay(new Date(key + "T00:00:00"), -1)) ? length + 1 : 1;
    longest = Math.max(longest, length);
    previous = key;
  }
  let current = 0,
    date = new Date(now);
  if (!dates.has(fmt.dayKey(date))) date = shiftDay(date, -1);
  while (dates.has(fmt.dayKey(date))) {
    current++;
    date = shiftDay(date, -1);
  }
  return { current, longest };
}
