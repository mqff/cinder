import { useMemo, useState } from "react";
import type { CallsResult } from "@/lib/types";
import { Panel, ShareBars, Stat, Empty } from "@/components/Primitives";
import { fmt } from "@/lib/format";
import { UsageChart } from "@/components/charts/UsageChart";
import { daySeries } from "@/lib/aggregate";
import { summarizeCalls } from "@/lib/call-summary";
import { sourceLabel } from "@/lib/navigation";
import { Choice } from "@/components/Choice";
import { ExpandableList } from "@/components/ExpandableList";
export function Calls({
  calls,
  loading,
  refresh,
  cancel
}: {
  calls: CallsResult | null;
  loading: boolean;
  refresh: () => void;
  cancel: () => void;
}) {
  const [source, setSource] = useState("");
  const selectedSource = source && calls?.sources[source] ? source : "";
  const { total, tools, skills, servers, mcpTools, byDay } = useMemo(
    () => summarizeCalls(calls, selectedSource),
    [calls, selectedSource]
  );
  const options = useMemo(
    () => [
      {
        value: "",
        label: "All call sources",
        count: Object.values(calls?.sources || {}).reduce((total, stats) => total + stats.total, 0)
      },
      ...Object.entries(calls?.sources || {})
        .map(([name, stats]) => ({ value: name, label: sourceLabel(name), count: stats.total }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    ],
    [calls]
  );
  if (!calls)
    return (
      <Empty title={loading ? "Reading tool calls..." : "No calls loaded"}>
        <button className="button" disabled={loading} onClick={refresh}>
          Scan tool calls
        </button>
        {loading && (
          <button className="button" onClick={cancel}>
            Cancel scan
          </button>
        )}
      </Empty>
    );
  return (
    <div className="view-stack">
      <div className="calls-toolbar">
        <Choice
          label="Tool-call source"
          icon="providers"
          value={selectedSource}
          options={options}
          onChange={setSource}
          active={!!selectedSource}
        />
        <span className="toolbar-meta">All time</span>
        <span className="toolbar-count">
          {selectedSource ? "1 source" : `${Object.keys(calls.sources).length} sources`}
        </span>
        {loading && (
          <button className="button" onClick={cancel}>
            Cancel scan
          </button>
        )}
      </div>
      <div className="stats-grid">
        <Stat label="Total calls" value={fmt.int(total)} />
        <Stat label="Tool calls" value={fmt.int(tools.reduce((sum, row) => sum + row.value, 0))} />
        <Stat label="MCP calls" value={fmt.int(servers.reduce((sum, row) => sum + row.value, 0))} />
        <Stat label="Skill calls" value={fmt.int(skills.reduce((sum, row) => sum + row.value, 0))} />
      </div>
      <Panel title="Calls over time" hint="Last 90 calendar days">
        <UsageChart points={daySeries(byDay, 90)} metric="requests" />
      </Panel>
      <div className="two-columns">
        <Panel title="Tools">
          <ShareBars rows={tools} />
        </Panel>
        <Panel title="MCP servers">
          <ShareBars rows={servers} />
        </Panel>
        <Panel title="Skills">
          <ShareBars rows={skills} />
        </Panel>
        <Panel title="MCP tools">
          <ShareBars rows={mcpTools} />
        </Panel>
      </div>
      <Panel title="Installed integrations">
        <div className="two-columns">
          <div>
            <h3>Skills</h3>
            <ExpandableList items={calls.installed?.skills || []}>
              {(visible) => (
                <ul className="integration-list">
                  {visible.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              )}
            </ExpandableList>
            {!calls.installed?.skills.length && <p className="note">None discovered</p>}
          </div>
          <div>
            <h3>MCP servers</h3>
            <ExpandableList
              items={Object.entries(calls.installed?.mcp || {}).flatMap(([source, servers]) =>
                servers.map((name) => ({ source, name }))
              )}
            >
              {(visible) => (
                <ul className="integration-list">
                  {visible.map(({ source, name }) => (
                    <li key={`${source}:${name}`}>
                      <span>{name}</span>
                      <small>{sourceLabel(source)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </ExpandableList>
          </div>
        </div>
      </Panel>
    </div>
  );
}
