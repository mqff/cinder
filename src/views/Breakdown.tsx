import { useMemo, useState } from "react";
import type { Bucket, Entry } from "@/lib/types";
import { summarize } from "@/lib/aggregate";
import { fmt } from "@/lib/format";
import { Panel, ShareBars } from "@/components/Primitives";
import { ExpandableList } from "@/components/ExpandableList";

export function Breakdown({
  rows,
  entries,
  kind,
  onModel
}: {
  rows: Bucket[];
  entries: Entry[];
  kind: "models" | "projects";
  onModel: (model: string) => void;
}) {
  const [sort, setSort] = useState<"tokens" | "cost" | "requests">("tokens");
  const [selected, setSelected] = useState("");
  const sorted = useMemo(() => [...rows].sort((a, b) => b[sort] - a[sort]), [rows, sort]);
  const project = kind === "projects" ? rows.find((row) => row.name === selected)?.name || sorted[0]?.name : null;
  const projectModels = useMemo(
    () => (project ? summarize(entries.filter((entry) => entry.project === project)).models : []),
    [entries, project]
  );
  return (
    <div className="view-stack">
      <Panel
        title={kind === "models" ? "Models" : "Projects"}
        hint={
          <div className="segmented">
            {(["tokens", "cost", "requests"] as const).map((key) => (
              <button key={key} aria-pressed={key === sort} onClick={() => setSort(key)}>
                {key[0].toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>
        }
      >
        <ExpandableList items={sorted}>
          {(visible) => (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{kind === "models" ? "Model" : "Project"}</th>
                    <th>Requests</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Cache write</th>
                    <th>Cache read</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.name}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => (kind === "models" ? onModel(row.name) : setSelected(row.name))}
                        >
                          {row.name}
                        </button>
                      </td>
                      <td>{fmt.int(row.requests)}</td>
                      <td>{fmt.compact(row.input)}</td>
                      <td>{fmt.compact(row.output)}</td>
                      <td>{fmt.compact(row.cacheWrite)}</td>
                      <td>{fmt.compact(row.cacheRead)}</td>
                      <td>{fmt.compact(row.tokens)}</td>
                      <td>{fmt.cost(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ExpandableList>
      </Panel>
      {project && (
        <Panel title={project} hint="Models">
          <ShareBars
            rows={projectModels.map((model) => ({ name: model.name, value: model.tokens }))}
            onSelect={onModel}
          />
        </Panel>
      )}
    </div>
  );
}
