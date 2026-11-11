import { summarize } from "@/lib/aggregate";
import { useMemo } from "react";
import { sourceLabel } from "@/lib/navigation";
import type { Entry, Summary } from "@/lib/types";
import { Panel, ShareBars, Stat, Metadata } from "@/components/Primitives";
import { fmt } from "@/lib/format";
import { ExpandableList } from "@/components/ExpandableList";
export function Providers({ full, entries, onLimits }: { full: Summary; entries: Entry[]; onLimits: () => void }) {
  const summaries = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const entry of entries) {
      if (!groups.has(entry.source)) groups.set(entry.source, []);
      groups.get(entry.source)!.push(entry);
    }
    return new Map([...groups].map(([source, records]) => [source, summarize(records)]));
  }, [entries]);
  return (
    <div className="view-stack">
      <div className="two-columns">
        <Panel title="Token share">
          <ShareBars rows={full.sources.map((source) => ({ name: source.name, value: source.tokens }))} />
        </Panel>
        <Panel title="Cost share">
          <ShareBars
            rows={full.sources.map((source) => ({ name: source.name, value: source.cost, unpriced: source.unpriced }))}
            money
          />
        </Panel>
      </div>
      <ExpandableList items={full.sources}>
        {(visible) => (
          <div className="two-columns">
            {visible.map((source) => {
              const sum = summaries.get(source.name)!;
              return (
                <Panel
                  key={source.name}
                  title={sourceLabel(source.name)}
                  hint={
                    <Metadata
                      items={[
                        { label: "Models", value: sum.models.length },
                        { label: "Sessions", value: sum.sessions }
                      ]}
                    />
                  }
                >
                  <div className="stats-grid compact-stats">
                    <Stat
                      label="Tokens"
                      value={source.name === "cursor" ? "Unavailable" : fmt.compact(source.tokens)}
                    />
                    <Stat label="Requests" value={fmt.int(source.requests)} />
                    <Stat label="Cost" value={source.name === "cursor" ? "Unavailable" : fmt.cost(source)} />
                  </div>
                  <ShareBars
                    rows={sum.models.map((model) => ({
                      name: model.name,
                      value: source.tokens ? model.tokens : model.requests
                    }))}
                  />
                  {source.name === "cursor" && (
                    <p className="note">
                      Cursor local history records requests and tools, without token counts.{" "}
                      <button className="text-button" onClick={onLimits}>
                        View account tokens and costs
                      </button>
                    </p>
                  )}
                </Panel>
              );
            })}
          </div>
        )}
      </ExpandableList>
    </div>
  );
}
