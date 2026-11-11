import { useMemo } from "react";
import type { UsageFacets, UsageSelection } from "@/lib/types";
import { sourceLabel } from "@/lib/navigation";
import { Choice } from "./Choice";
import { Glyph } from "./Glyph";
export function UsageFilters({
  period,
  onPeriod,
  selection,
  onSelection,
  facets
}: {
  period: number;
  onPeriod: (period: number) => void;
  selection: UsageSelection;
  onSelection: (selection: UsageSelection) => void;
  facets: UsageFacets;
}) {
  const filters = useMemo(
    () =>
      (
        [
          { key: "source", label: "Providers", icon: "providers", rows: facets.source },
          { key: "model", label: "Models", icon: "models", rows: facets.model },
          { key: "project", label: "Projects", icon: "projects", rows: facets.project }
        ] as const
      ).map(({ rows, ...filter }) => ({
        ...filter,
        options: [
          {
            value: "",
            label: `All ${filter.label.toLowerCase()}`,
            count: rows.reduce((total, row) => total + row.requests, 0)
          },
          ...rows.map((row) => ({
            value: row.name,
            label: filter.key === "source" ? sourceLabel(row.name) : row.name,
            count: row.requests
          }))
        ]
      })),
    [facets]
  );
  const active = Object.values(selection).some(Boolean);
  return (
    <div className="filterbar">
      <div className="segmented" role="group" aria-label="Period">
        {[1, 7, 30, 90, 0].map((days) => (
          <button
            key={days}
            aria-label={days ? `${days} ${days === 1 ? "day" : "days"}` : "All time"}
            aria-pressed={period === days}
            onClick={() => onPeriod(days)}
          >
            {days === 1 ? "Today" : days ? `${days}D` : "All time"}
          </button>
        ))}
      </div>
      <div className="filter-selects">
        {filters.map(({ key, label, icon, options }) => (
          <Choice
            key={key}
            label={label}
            icon={icon}
            options={options}
            value={selection[key]}
            active={!!selection[key]}
            wide={key !== "source"}
            onChange={(value) => onSelection({ ...selection, [key]: value })}
          />
        ))}
        {active && (
          <button
            className="filter-reset"
            aria-label="Clear usage filters"
            title="Clear filters"
            onClick={() => onSelection({ source: "", model: "", project: "" })}
          >
            <Glyph name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
