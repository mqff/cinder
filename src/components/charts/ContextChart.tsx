import { useElementWidth } from "@/hooks/useElementWidth";
import { useMemo, useState } from "react";
import type { Entry } from "@/lib/types";
import { fmt } from "@/lib/format";
import { Metadata } from "../Primitives";

export function ContextChart({ entries: raw }: { entries: Entry[] }) {
  const entries = useMemo(() => {
    const minutes = new Map<number, Entry>();
    for (const entry of raw) {
      const key = Math.floor(entry.t / 60000) * 60000;
      const previous = minutes.get(key);
      if (!previous) minutes.set(key, { ...entry, t: key, n: entry.n || 1 });
      else {
        previous.input += entry.input;
        previous.cacheRead += entry.cacheRead;
        previous.cacheWrite += entry.cacheWrite;
        previous.cost += entry.cost;
        previous.n = (previous.n || 1) + (entry.n || 1);
        previous.unpriced = (previous.unpriced || 0) + (entry.unpriced || 0);
      }
    }
    return [...minutes.values()].sort((a, b) => a.t - b.t);
  }, [raw]);
  const [hover, setHover] = useState<number | null>(null);
  const { ref, width } = useElementWidth(800);
  const geometry = useMemo(() => {
    const maximum = entries.reduce((max, entry) => Math.max(max, entry.input + entry.cacheRead + entry.cacheWrite), 0);
    const first = entries[0]?.t || 0,
      last = entries.at(-1)?.t || first;
    const positions = entries.map((entry) => ({
      x: 45 + (last === first ? 0.5 : (entry.t - first) / (last - first)) * (width - 65),
      y: 155 - ((entry.input + entry.cacheRead + entry.cacheWrite) / Math.max(1, maximum)) * 135
    }));
    return { maximum, first, last, positions, points: positions.map((point) => `${point.x},${point.y}`).join(" ") };
  }, [entries, width]);
  const { maximum, first, last } = geometry;
  const x = (index: number) => geometry.positions[index].x;
  const y = (index: number) => geometry.positions[index].y;
  const active = hover === null ? null : entries[hover];
  return (
    <div ref={ref}>
      <svg
        className="context-chart"
        viewBox={`0 0 ${width} 180`}
        role="img"
        aria-label="Input volume per minute, including cache, positioned by time"
        tabIndex={0}
        onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setHover((current) =>
            Math.max(
              0,
              Math.min(entries.length - 1, (current ?? entries.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))
            )
          );
        }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const position = ((event.clientX - bounds.left) / bounds.width) * width;
          const time = first + ((position - 45) / (width - 65)) * (last - first);
          let low = 0,
            high = entries.length - 1;
          while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (entries[mid].t < time) low = mid + 1;
            else high = mid;
          }
          setHover(low > 0 && Math.abs(entries[low - 1].t - time) < Math.abs(entries[low].t - time) ? low - 1 : low);
        }}
      >
        <line x1="40" x2={width - 15} y1="155" y2="155" stroke="var(--border)" />
        <text x="35" y="22" textAnchor="end" fill="var(--muted-foreground)" fontSize="10">
          {fmt.compact(maximum)}
        </text>
        <text x="35" y="158" textAnchor="end" fill="var(--muted-foreground)" fontSize="10">
          0
        </text>
        <polyline fill="none" stroke="var(--brand)" strokeWidth="2" points={geometry.points} />
        <text x="45" y="177" textAnchor="start" fill="var(--muted-foreground)" fontSize="10">
          {new Date(first).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </text>
        <text x={width - 20} y="177" textAnchor="end" fill="var(--muted-foreground)" fontSize="10">
          {new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </text>
        {entries.length === 1 && <circle cx={x(0)} cy={y(0)} r="4" fill="var(--brand)" />}
        {active && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1="15" y2="155" stroke="var(--muted-foreground)" />
            <circle cx={x(hover)} cy={y(hover)} r="4" fill="var(--brand)" />
          </>
        )}
      </svg>
      <div className="context-chart-caption" aria-live="polite">
        {active ? (
          <Metadata
            items={[
              { label: "Time", value: new Date(active.t).toLocaleTimeString() },
              { label: "Requests", value: fmt.int(active.n || 1) },
              { label: "Input", value: fmt.int(active.input) },
              { label: "Cache read", value: fmt.int(active.cacheRead) },
              { label: "Cache write", value: fmt.int(active.cacheWrite) },
              { label: "Cost", value: fmt.cost(active) }
            ]}
          />
        ) : (
          <Metadata items={[{ label: "Peak minute", value: `${fmt.int(maximum)} input tokens` }]} />
        )}
      </div>
    </div>
  );
}
