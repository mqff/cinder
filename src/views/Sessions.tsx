import { ContextChart } from "@/components/charts/ContextChart";
import { useDeferredValue, useMemo, useState } from "react";
import type { Entry } from "@/lib/types";
import { totalsOf } from "@/lib/aggregate";
import { fmt } from "@/lib/format";
import { Panel, Stat, Empty, Metadata } from "@/components/Primitives";
import { Choice } from "@/components/Choice";
import { Glyph } from "@/components/Glyph";
import { sourceLabel } from "@/lib/navigation";
import { ExpandableList } from "@/components/ExpandableList";

const sortOptions = [
  { value: "recent", label: "Most recent" },
  { value: "cost", label: "Highest cost" },
  { value: "tokens", label: "Most tokens" },
  { value: "turns", label: "Most requests" },
  { value: "project", label: "Project A–Z" }
];
export function Sessions({ entries }: { entries: Entry[] }) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState("");
  const [sort, setSort] = useState("cost");
  const [recordSort, setRecordSort] = useState("tokens");
  const search = useDeferredValue(query.trim().toLowerCase());
  const sessions = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const entry of entries) {
      const key = JSON.stringify([entry.source, entry.session]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }
    return [...groups].map(([key, records]) => {
      records.sort((a, b) => a.t - b.t);
      const totals = totalsOf(records);
      return {
        key,
        records,
        sum: { totals, count: totals.requests },
        first: records[0],
        last: records[records.length - 1],
        hasCost: totals.tokens > 0 || totals.cost > 0 || records.some((entry) => entry.costOrigin === "reported"),
        search:
          `${records[0].project} ${records[0].session} ${sourceLabel(records[0].source)} ${[...new Set(records.map((record) => record.model))].join(" ")}`.toLowerCase()
      };
    });
  }, [entries]);
  const filtered = useMemo(
    () =>
      sessions
        .filter((session) => session.search.includes(search))
        .sort((a, b) =>
          sort === "cost"
            ? b.sum.totals.cost - a.sum.totals.cost
            : sort === "tokens"
              ? b.sum.totals.tokens - a.sum.totals.tokens
              : sort === "turns"
                ? b.sum.count - a.sum.count
                : sort === "project"
                  ? a.first.project.localeCompare(b.first.project)
                  : b.last.t - a.last.t
        ),
    [sessions, search, sort]
  );
  const active = filtered.find((session) => session.key === selected) || filtered[0];
  const records = useMemo(
    () =>
      [...(active?.records || [])].sort((a, b) =>
        recordSort === "recent"
          ? b.t - a.t
          : recordSort === "cost"
            ? b.cost - a.cost
            : b.input + b.output + b.cacheRead + b.cacheWrite - (a.input + a.output + a.cacheRead + a.cacheWrite)
      ),
    [active, recordSort]
  );
  return (
    <div className="session-layout">
      <aside className="session-sidebar" aria-label="Session browser">
        <div className="session-controls">
          <div className="session-search">
            <Glyph name="search" size={14} />
            <input
              aria-label="Search sessions"
              placeholder="Search sessions..."
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            {query && (
              <button aria-label="Clear session search" onClick={() => setQuery("")}>
                <Glyph name="close" size={12} />
              </button>
            )}
          </div>
          <Choice label="Sort sessions" value={sort} onChange={setSort} options={sortOptions} />
          <p className="session-count" aria-live="polite">
            {fmt.int(filtered.length)} {filtered.length === 1 ? "session" : "sessions"}
          </p>
        </div>
        <div className="session-list" aria-busy={search !== query.trim().toLowerCase()}>
          <ExpandableList key={`${search}:${sort}`} items={filtered}>
            {(visible) => (
              <div className="session-items">
                {visible.map((session) => (
                  <button
                    key={session.key}
                    className={`session-item ${session.key === active?.key ? "active" : ""}`}
                    aria-current={session.key === active?.key ? "true" : undefined}
                    onClick={() => {
                      setSelected(session.key);
                    }}
                  >
                    <strong>
                      <span title={session.first.project}>{session.first.project}</span>
                      <b>{session.hasCost ? fmt.cost(session.sum.totals) : "Unavailable"}</b>
                    </strong>
                    <code title={session.first.session}>{session.first.session}</code>
                    <span className="session-item-meta">
                      <span>{sourceLabel(session.first.source)}</span>
                      <span>
                        {fmt.int(session.sum.count)} {session.sum.count === 1 ? "request" : "requests"}
                      </span>
                    </span>
                    <small>{new Date(session.last.t).toLocaleString()}</small>
                  </button>
                ))}
              </div>
            )}
          </ExpandableList>
        </div>
      </aside>
      {active ? (
        <div className="view-stack session-detail">
          <div className="session-heading">
            <h2>{active.first.project}</h2>
            <p className="note">
              <span>{sourceLabel(active.first.source)}</span>
              <code title={active.first.session}>{active.first.session}</code>
            </p>
            <Metadata
              items={[
                { label: "Started", value: new Date(active.first.t).toLocaleString() },
                { label: "Last activity", value: new Date(active.last.t).toLocaleString() }
              ]}
            />
          </div>
          <div className="stats-grid">
            <Stat label="Cost" value={active.hasCost ? fmt.cost(active.sum.totals) : "Unavailable"} />
            <Stat
              label="Tokens"
              value={active.sum.totals.tokens ? fmt.compact(active.sum.totals.tokens) : "Unavailable"}
            />
            <Stat label="Requests" value={fmt.int(active.sum.count)} />
            <Stat label="Last model" value={fmt.modelShort(active.last.model)} />
          </div>
          <Panel title="Input volume" hint="Input and cache per minute">
            {active.sum.totals.tokens ? (
              <ContextChart entries={active.records} />
            ) : (
              <p className="note">This session history does not include token counts.</p>
            )}
          </Panel>
          <Panel
            title="Usage records"
            hint={
              <Choice
                label="Sort usage records"
                value={recordSort}
                onChange={setRecordSort}
                options={[
                  { value: "tokens", label: "Most tokens" },
                  { value: "cost", label: "Highest cost" },
                  { value: "recent", label: "Most recent" }
                ]}
              />
            }
          >
            <div className="record-count">
              <Metadata
                items={[
                  { label: "Minute/model buckets", value: fmt.int(active.records.length) },
                  { label: "Requests", value: fmt.int(active.sum.count) }
                ]}
              />
            </div>
            <ExpandableList key={`${active.key}:${recordSort}`} items={records}>
              {(visible) => (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {["Time", "Model", "Requests", "Input", "Output", "Cache write", "Cache read", "Cost"].map(
                          (label) => (
                            <th key={label}>{label}</th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((entry, index) => (
                        <tr key={index}>
                          <td title={new Date(entry.t).toLocaleString()}>
                            {new Date(entry.t).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </td>
                          <td title={entry.model}>
                            {fmt.modelShort(entry.model)}
                            {entry.speed && entry.speed !== "standard" && (
                              <small className="speed-label">{entry.speed}</small>
                            )}
                          </td>
                          <td>{entry.n || 1}</td>
                          <td>{fmt.int(entry.input)}</td>
                          <td>{fmt.int(entry.output)}</td>
                          <td>{fmt.int(entry.cacheWrite)}</td>
                          <td>{fmt.int(entry.cacheRead)}</td>
                          <td>{fmt.cost(entry)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ExpandableList>
          </Panel>
        </div>
      ) : (
        <Empty title="No matching sessions">Try a different search.</Empty>
      )}
    </div>
  );
}
