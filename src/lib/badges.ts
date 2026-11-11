import { fmt } from "./format";
import type { Summary } from "./types";
import { streaks } from "./aggregate";

const TINT = {
  brand: "var(--brand)",
  green: "var(--data-2)",
  amber: "var(--data-3)",
  mauve: "var(--data-4)",
  blue: "var(--data-5)"
};

type Kind = "int" | "compact" | "usd" | "days";

interface TrackDef {
  id: string;
  name: string;
  tint: string;
  kind: Kind;
  th: number[];
  val: (s: Summary, extra: Extra) => number;
}

interface Extra {
  bestStreak: number;
}

const TRACKS: TrackDef[] = [
  {
    id: "requests",
    name: "Requests",
    tint: TINT.brand,
    kind: "int",
    th: [100, 500, 1e3, 5e3, 1e4, 5e4, 1e5, 5e5, 1e6],
    val: (s) => s.totals.requests
  },
  {
    id: "tokens",
    name: "Tokens",
    tint: TINT.green,
    kind: "compact",
    th: [1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12],
    val: (s) => s.totals.tokens
  },
  {
    id: "output",
    name: "Output",
    tint: TINT.amber,
    kind: "compact",
    th: [1e5, 1e6, 1e7, 5e7, 1e8, 5e8, 1e9],
    val: (s) => s.totals.output
  },
  {
    id: "cache",
    name: "Cache reads",
    tint: TINT.green,
    kind: "compact",
    th: [1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12],
    val: (s) => s.totals.cacheRead
  },
  {
    id: "cost",
    name: "Spend",
    tint: TINT.mauve,
    kind: "usd",
    th: [10, 50, 100, 500, 1e3, 5e3, 1e4, 5e4],
    val: (s) => s.totals.cost
  },
  {
    id: "models",
    name: "Models",
    tint: TINT.blue,
    kind: "int",
    th: [2, 3, 5, 8, 12, 16, 24],
    val: (s) => s.models.length
  },
  {
    id: "projects",
    name: "Projects",
    tint: TINT.mauve,
    kind: "int",
    th: [2, 5, 10, 20, 40, 80, 160],
    val: (s) => s.projects.length
  },
  {
    id: "days",
    name: "Active days",
    tint: TINT.green,
    kind: "int",
    th: [7, 30, 90, 180, 365, 730],
    val: (s) => s.activeDays
  },
  {
    id: "streak",
    name: "Streak",
    tint: TINT.amber,
    kind: "days",
    th: [3, 7, 14, 30, 60, 100, 180, 365],
    val: (_s, e) => e.bestStreak
  }
];

export interface TrackResult {
  id: string;
  name: string;
  tint: string;
  level: number;
  tierLabel: string;
  valueText: string;
  nextText: string;
  progress: number;
}
function display(kind: Kind, value: number) {
  return kind === "usd"
    ? fmt.usd(value)
    : kind === "compact"
      ? fmt.compact(value)
      : kind === "days"
        ? `${value}d`
        : fmt.int(value);
}
function threshold(track: TrackDef, level: number) {
  return track.th[level] ?? track.th[track.th.length - 1] * 10 ** (level - track.th.length + 1);
}
export function evaluateTracks(summary: Summary): TrackResult[] {
  const history = streaks(summary.byDay);
  return TRACKS.map((track) => {
    const value = track.val(summary, { bestStreak: Math.max(history.current, history.longest) });
    let level = 0;
    while (level < 300 && value >= threshold(track, level)) level++;
    const prev = level ? threshold(track, level - 1) : 0,
      next = threshold(track, level);
    const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];
    return {
      id: track.id,
      name: track.name,
      tint: track.tint,
      level,
      tierLabel: level ? `${track.name} ${roman[level - 1] || level}` : "Unranked",
      valueText: track.id === "cost" ? fmt.cost(summary.totals) : display(track.kind, value),
      nextText: display(track.kind, next),
      progress: Math.min(1, Math.max(0, (value - prev) / (next - prev)))
    };
  });
}
const ranks = [
  "Novice",
  "Initiate",
  "Apprentice",
  "Adept",
  "Specialist",
  "Expert",
  "Veteran",
  "Master",
  "Grandmaster",
  "Elite",
  "Legend",
  "Mythic",
  "Ascendant",
  "Immortal"
];
const levels = [0, 4, 9, 15, 22, 30, 39, 49, 60, 72, 85, 99, 114, 130];
export function globalRank(tracks: TrackResult[]) {
  const totalLevels = tracks.reduce((sum, track) => sum + track.level, 0);
  let index = levels.findIndex(
    (minimum, i) => totalLevels >= minimum && (i === levels.length - 1 || totalLevels < levels[i + 1])
  );
  if (index < 0) index = 0;
  const atNext = levels[index + 1] ?? null,
    atCurrent = levels[index];
  return {
    rank: ranks[index],
    nextRank: ranks[index + 1] ?? null,
    totalLevels,
    atNext,
    progress: atNext === null ? 1 : (totalLevels - atCurrent) / (atNext - atCurrent),
    trackCount: tracks.length
  };
}
