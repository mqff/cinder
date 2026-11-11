import { useElementWidth } from "@/hooks/useElementWidth";
import { useState } from "react";
import type { DayPoint } from "@/lib/types";
import { fmt } from "@/lib/format";

export function UsageChart({
  points,
  metric = "tokens",
  interval = "day"
}: {
  points: DayPoint[];
  metric?: "tokens" | "cost" | "requests";
  interval?: "day" | "hour";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { ref, width } = useElementWidth(840);
  const height = 240,
    left = 54,
    right = 10,
    top = 18,
    bottom = 30;
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  const max = points.reduce((maximum, point) => Math.max(maximum, point[metric]), 0) || 1;
  const format = metric === "cost" ? fmt.usd : fmt.compact;
  const step = plotWidth / Math.max(1, points.length);
  const active = hover === null ? null : points[hover];
  const label = (key: string) => (interval === "hour" ? key : fmt.dayLabel(key));
  const ticks = interval === "hour" ? [0, 6, 12, 18, 23] : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return (
    <div ref={ref} className="usage-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${interval === "hour" ? "Hourly" : "Daily"} ${metric} chart`}
        tabIndex={0}
        onBlur={() => setHover(null)}
        onMouseLeave={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setHover((current) =>
            Math.max(
              0,
              Math.min(points.length - 1, (current ?? points.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))
            )
          );
        }}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - bounds.left) / bounds.width) * width - left;
          setHover(Math.max(0, Math.min(points.length - 1, Math.floor(x / step))));
        }}
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1={left}
              x2={width - right}
              y1={top + plotHeight * (1 - fraction)}
              y2={top + plotHeight * (1 - fraction)}
              stroke="var(--border)"
            />
            <text x={left - 10} y={top + plotHeight * (1 - fraction) + 4} textAnchor="end">
              {format(max * fraction)}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const barHeight = (point[metric] / max) * plotHeight;
          return (
            <rect
              key={point.key}
              x={left + step * index + step * 0.17}
              y={top + plotHeight - barHeight}
              width={Math.max(0.5, step * 0.66)}
              height={Math.max(0, barHeight)}
              rx={Math.min(1.5, step * 0.1)}
              fill="var(--chart-bar)"
              opacity={hover === null || hover === index ? 1 : 0.45}
            >
              <title>
                {label(point.key)}: {format(point[metric])}
              </title>
            </rect>
          );
        })}
        {[...new Set(ticks)]
          .filter((index) => points[index])
          .map((index) => (
            <text
              key={index}
              x={left + step * (index + 0.5)}
              y={height - 7}
              textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
            >
              {label(points[index].key)}
            </text>
          ))}
      </svg>
      <div className="chart-caption" aria-live="polite">
        {active ? (
          <>
            <span>{label(active.key)}</span>
            <strong>{format(active[metric])}</strong>
          </>
        ) : (
          "\u00a0"
        )}
      </div>
    </div>
  );
}
