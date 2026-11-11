import type { Entry, Summary } from "@/lib/types";
import { useMemo } from "react";
import { blank, daySeries, streaks } from "@/lib/aggregate";
import { fmt } from "@/lib/format";
import { sourceLabel } from "@/lib/navigation";
import { Panel, Stat } from "@/components/Primitives";
import { ExpandableList } from "@/components/ExpandableList";
function MapGrid({ byDay, days }: { byDay: Summary["byDay"]; days: number }) {
  const points = daySeries(byDay, days || 371);
  const max = Math.max(1, ...points.map((point) => point.requests));
  return (
    <div className="heatmap" role="img" aria-label="Requests by day">
      {points.map((point) => (
        <span
          key={point.key}
          title={`${point.key}: ${fmt.int(point.requests)} requests`}
          style={{
            background: point.requests
              ? `color-mix(in srgb, var(--brand) ${20 + (point.requests / max) * 80}%, var(--card))`
              : "var(--muted)"
          }}
        />
      ))}
    </div>
  );
}
export function Activity({
  sum,
  full,
  entries,
  period
}: {
  sum: Summary;
  full: Summary;
  entries: Entry[];
  period: number;
}) {
  const streak = streaks(full.byDay);
  const peak = sum.byHour.reduce((best, hour, index) => (hour.tokens > sum.byHour[best].tokens ? index : best), 0);
  const max = Math.max(1, ...sum.byHour.map((hour) => hour.tokens));
  const providerDays = useMemo(() => {
    const sources = new Map<string, Summary["byDay"]>();
    for (const entry of entries) {
      if (!sources.has(entry.source)) sources.set(entry.source, new Map());
      const days = sources.get(entry.source)!;
      const key = fmt.dayKey(entry.t);
      if (!days.has(key)) days.set(key, blank());
      days.get(key)!.requests += entry.n ?? 1;
    }
    return sources;
  }, [entries]);
  return (
    <div className="view-stack">
      <div className="stats-grid">
        <Stat label="Current streak" value={`${streak.current} ${streak.current === 1 ? "day" : "days"}`} />
        <Stat label="Longest streak" value={`${streak.longest} ${streak.longest === 1 ? "day" : "days"}`} />
        <Stat label="Active days" value={fmt.int(sum.activeDays)} />
        <Stat label="Peak hour" value={`${String(peak).padStart(2, "0")}:00`} />
      </div>
      <div className={period ? "two-columns" : "view-stack"}>
        <Panel title="Activity map" hint={`${period || 371} local calendar days`}>
          <MapGrid byDay={sum.byDay} days={period} />
          <div className="chart-caption">One square per day</div>
        </Panel>
        <Panel title="Hourly rhythm" hint="Tokens by local hour">
          <div className="hourly">
            {sum.byHour.map((hour, index) => (
              <div
                key={index}
                title={`${String(index).padStart(2, "0")}:00\nTokens: ${fmt.int(hour.tokens)}\nRequests: ${fmt.int(hour.requests)}`}
              >
                <i style={{ height: `${(hour.tokens / max) * 130}px` }} />
                <small>{index % 3 === 0 ? index.toString().padStart(2, "0") : ""}</small>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      {sum.sources.length > 1 && (
        <Panel title="Activity by provider">
          <ExpandableList items={sum.sources}>
            {(visible) =>
              visible.map((source) => (
                <div className="provider-heat" key={source.name}>
                  <span>{sourceLabel(source.name)}</span>
                  <MapGrid byDay={providerDays.get(source.name)!} days={period} />
                </div>
              ))
            }
          </ExpandableList>
        </Panel>
      )}
    </div>
  );
}
