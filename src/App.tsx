import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DesktopChrome } from "@/components/DesktopChrome";
import { AppDialog } from "@/components/AppDialog";
import { Glyph } from "@/components/Glyph";
import { Settings } from "@/components/Settings";
import { UsageFilters } from "@/components/UsageFilters";
import type { Entry, UsageSelection } from "@/lib/types";
import { Empty, Panel, Stat } from "@/components/Primitives";
import { UsageChart } from "@/components/charts/UsageChart";
import { useDashboard } from "@/hooks/useDashboard";
import { usePreferences } from "@/hooks/usePreferences";
import { daySeries, hourSeries, queryUsage, summarize } from "@/lib/aggregate";
import { exportUsage } from "@/lib/export";
import { fmt } from "@/lib/format";
import { views, type ViewId } from "@/lib/navigation";
import { readPref, writePref } from "@/lib/prefs";
import { Overview } from "@/views/Overview";
import { Activity } from "@/views/Activity";
import { Breakdown } from "@/views/Breakdown";
import { Sessions } from "@/views/Sessions";
import { Providers } from "@/views/Providers";
import { Calls } from "@/views/Calls";
import { Badges } from "@/views/Badges";
import { Limits } from "@/views/Limits";
import { useLimits } from "@/hooks/useLimits";
import { PricingEditor } from "@/components/PricingEditor";
import { AppearanceSettings } from "@/components/AppearanceSettings";
import { Commands } from "@/components/Commands";

type Dialog =
  { kind: "settings" } | { kind: "commands" } | { kind: "themes" } | { kind: "model"; model: string } | null;
const noSelection: UsageSelection = { source: "", model: "", project: "" };
const emptyEntries: Entry[] = [];
const emptyQuery = { entries: emptyEntries, facets: { source: [], model: [], project: [] } };

export function App() {
  const dashboard = useDashboard();
  const preferences = usePreferences();
  const [view, setView] = useState<ViewId>(() => views.find(([id]) => id === readPref("view"))?.[0] || "overview");
  const [selection, setSelection] = useState(noSelection);
  const limits = useLimits(view === "limits");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [clock, setClock] = useState(() => new Date());
  const now = useMemo(() => new Date(), [clock, dashboard.usage]);
  const main = useRef<HTMLElement>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const inspectModel = (model: string) => setDialog({ kind: "model", model });
  const openCommands = () => {
    setDialog({ kind: "commands" });
  };
  const refresh = useCallback(
    () => (view === "limits" ? limits.refresh() : view === "calls" ? dashboard.refreshCalls() : dashboard.scan()),
    [view, dashboard.refreshCalls, dashboard.scan, limits.refresh]
  );

  useEffect(() => {
    writePref("view", view);
    main.current?.scrollTo(0, 0);
  }, [view]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!preferences.autoRefresh || dashboard.phase !== "ready") return;
    const timer = setInterval(() => {
      if (!document.hidden) void dashboard.scan();
    }, 60000);
    return () => clearInterval(timer);
  }, [preferences.autoRefresh, dashboard.phase, dashboard.scan]);
  useEffect(() => window.cinder?.onMenuRescan(() => void refresh()), [refresh]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const modalOpen = !!document.querySelector("dialog[open]");
      if (event.altKey && (event.code === "KeyA" || event.key.toLowerCase() === "a")) {
        event.preventDefault();
        if (modalOpen) return;
        if (event.shiftKey)
          preferences.setMode(
            preferences.mode === "system" ? "light" : preferences.mode === "light" ? "dark" : "system"
          );
        else setDialog({ kind: "themes" });
        return;
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (modalOpen && dialog?.kind !== "commands") return;
        setDialog((current) => (current?.kind === "commands" ? null : { kind: "commands" }));
        return;
      }
      if ((event.target as HTMLElement).matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refresh();
      }
      if (modalOpen) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < views.length) {
        event.preventDefault();
        setView(views[index][0]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh, dialog, preferences.mode, preferences.setMode]);

  const entries = dashboard.usage?.entries;
  const all = useMemo(() => summarize(entries || emptyEntries), [entries]);
  const periodic = view !== "calls" && view !== "badges" && view !== "limits";
  const query = useMemo(
    () => (periodic ? queryUsage(entries || emptyEntries, preferences.period, selection, now) : emptyQuery),
    [entries, periodic, preferences.period, now, selection]
  );
  const filtered = query.entries;
  const sum = useMemo(() => (filtered === entries ? all : summarize(filtered)), [filtered, entries, all]);
  const model = dialog?.kind === "model" ? dialog.model : null;
  const modelSummary = useMemo(
    () => summarize(model ? filtered.filter((entry) => entry.model === model) : []),
    [filtered, model]
  );
  const diagnostics = [...(dashboard.usage?.diagnostics || []), ...(dashboard.calls?.diagnostics || [])];
  const title = views.find(([id]) => id === view)![1];
  const updatedAt =
    view === "limits"
      ? limits.data?.checkedAt
      : view === "calls"
        ? dashboard.calls?.scannedAt
        : dashboard.usage?.scannedAt;
  const refreshing = view === "limits" ? limits.busy : view === "calls" ? dashboard.callsBusy : dashboard.busy;
  const error = view === "limits" ? limits.error : dashboard.error || (view === "calls" ? dashboard.callsError : "");

  let content: ReactNode;
  if (view === "limits")
    content = (
      <Limits
        data={limits.data}
        busy={limits.busy}
        now={clock.getTime()}
        refresh={limits.refresh}
        reset={limits.reset}
      />
    );
  else if (view === "calls")
    content = (
      <Calls
        calls={dashboard.calls}
        loading={dashboard.callsBusy}
        refresh={() => void dashboard.refreshCalls()}
        cancel={dashboard.cancel}
      />
    );
  else if (view === "badges") content = <Badges full={all} />;
  else if ((dashboard.busy || dashboard.error) && !entries) content = null;
  else if (!filtered.length)
    content = (
      <Empty title={entries?.length ? "No matching records" : "No usage found"}>
        {entries?.length ? (
          <button
            className="button"
            onClick={() => {
              setSelection(noSelection);
              preferences.setPeriod(0);
            }}
          >
            Reset filters
          </button>
        ) : (
          "Refresh after using a supported tool."
        )}
      </Empty>
    );
  else if (view === "overview") content = <Overview sum={sum} period={preferences.period} onModel={inspectModel} />;
  else if (view === "activity")
    content = <Activity sum={sum} full={all} entries={filtered} period={preferences.period} />;
  else if (view === "sessions") content = <Sessions entries={filtered} />;
  else if (view === "providers")
    content = <Providers full={sum} entries={filtered} onLimits={() => setView("limits")} />;
  else
    content = (
      <Breakdown
        rows={view === "models" ? sum.models : sum.projects}
        entries={filtered}
        kind={view}
        onModel={inspectModel}
      />
    );

  return (
    <div className="app-shell">
      <DesktopChrome
        view={view}
        onView={setView}
        onSettings={() => setDialog({ kind: "settings" })}
        onCommands={openCommands}
      />
      <main ref={main} className="workspace">
        <header className="page-heading">
          <h1>{title}</h1>
          <div className="page-actions">
            {updatedAt && (
              <time dateTime={updatedAt} title={new Date(updatedAt).toLocaleString()}>
                Updated {new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
            )}
            {periodic && (
              <button className="button" disabled={!filtered.length} onClick={() => exportUsage(filtered)}>
                Export CSV
              </button>
            )}
            <button className="button refresh-button" disabled={refreshing} onClick={() => void refresh()}>
              <Glyph name="refresh" size={14} />
              {refreshing ? (view === "limits" ? "Checking…" : "Scanning...") : "Refresh"}
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className="notice error">
            {error}
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {view === "limits" ? (
          <div className="page-content">{content}</div>
        ) : dashboard.phase === "gate" ? (
          <div className="scan-welcome">
            <h2>{dashboard.snapshot ? "Saved scan" : "Scan cancelled"}</h2>
            <p>
              {dashboard.snapshot
                ? `${fmt.int(dashboard.snapshot.entries)} requests, ${dashboard.snapshot.sources} sources. ${new Date(dashboard.snapshot.savedAt).toLocaleString()}.`
                : "Run a scan to load usage."}
            </p>
            <div className="inline-controls">
              {dashboard.snapshot && (
                <button className="button primary" onClick={() => void dashboard.restore()}>
                  Open last scan
                </button>
              )}
              <button className="button" onClick={() => void dashboard.scan()}>
                New scan
              </button>
            </div>
          </div>
        ) : dashboard.phase === "boot" ? (
          <Empty title="Loading..." />
        ) : (
          <div className="page-content">
            {periodic && (
              <UsageFilters
                period={preferences.period}
                onPeriod={preferences.setPeriod}
                selection={selection}
                onSelection={setSelection}
                facets={query.facets}
              />
            )}
            {dashboard.busy && (
              <div className="scan-progress" role="status">
                <span>{dashboard.progress.label || "Scanning"}</span>
                <span>{fmt.int(dashboard.progress.files || 0)} files</span>
                <progress max={dashboard.progress.total || 1} value={dashboard.progress.done} />
                <button onClick={dashboard.cancel}>Cancel</button>
              </div>
            )}
            {diagnostics.length > 0 && (
              <details className="notice">
                <summary>
                  {diagnostics.length} scan {diagnostics.length === 1 ? "warning" : "warnings"}
                </summary>
                {diagnostics.map((item, index) => (
                  <p key={index}>
                    <b>{item.source}</b>: {item.message}
                    {item.file && <code>{item.file}</code>}
                  </p>
                ))}
              </details>
            )}
            {content}
          </div>
        )}
      </main>
      {dialog && (
        <AppDialog
          key={dialog.kind === "model" ? dialog.model : dialog.kind}
          title={
            dialog.kind === "settings"
              ? "Settings"
              : dialog.kind === "commands"
                ? "Commands"
                : dialog.kind === "themes"
                  ? "Appearance"
                  : dialog.model
          }
          onClose={closeDialog}
        >
          {dialog.kind === "settings" ? (
            <Settings
              preferences={preferences}
              usage={dashboard.usage}
              busy={dashboard.busy}
              onPricing={dashboard.savePricing}
            />
          ) : dialog.kind === "themes" ? (
            <AppearanceSettings preferences={preferences} />
          ) : dialog.kind === "commands" ? (
            <Commands
              onView={(id) => {
                setView(id);
                closeDialog();
              }}
              onThemes={() => setDialog({ kind: "themes" })}
              onSettings={() => setDialog({ kind: "settings" })}
            />
          ) : (
            <div className="view-stack">
              <div className="stats-grid">
                <Stat label="Tokens" value={fmt.compact(modelSummary.totals.tokens)} />
                <Stat label="Cost" value={fmt.cost(modelSummary.totals)} />
                <Stat label="Requests" value={fmt.int(modelSummary.count)} />
                <Stat
                  label="Cache hit rate"
                  value={fmt.pct(
                    modelSummary.totals.cacheRead /
                      Math.max(
                        1,
                        modelSummary.totals.input + modelSummary.totals.cacheRead + modelSummary.totals.cacheWrite
                      )
                  )}
                />
              </div>
              <UsageChart
                points={
                  preferences.period === 1
                    ? hourSeries(modelSummary.byHour)
                    : daySeries(modelSummary.byDay, preferences.period)
                }
                interval={preferences.period === 1 ? "hour" : "day"}
              />
              <p className="note">
                Estimated cache-read savings: {fmt.usd(modelSummary.totals.cacheSavings || 0)}. Compared with fresh
                input at catalog or custom rates; cache-write premiums are excluded.
              </p>
              <div className="stats-grid">
                <Stat
                  label="Cost / 1M tokens"
                  value={
                    modelSummary.totals.tokens
                      ? fmt.usd((modelSummary.totals.cost / modelSummary.totals.tokens) * 1e6)
                      : "Unavailable"
                  }
                />
                <Stat label="Input cost" value={fmt.usd(modelSummary.costBy.input)} />
                <Stat label="Output cost" value={fmt.usd(modelSummary.costBy.output)} />
                <Stat
                  label="Cache cost"
                  value={fmt.usd(modelSummary.costBy.cacheRead + modelSummary.costBy.cacheWrite)}
                />
              </div>
              <details className="model-pricing-details">
                <summary>Edit model pricing</summary>
                <Panel title="Price and inclusion">
                  <PricingEditor
                    model={dialog.model}
                    usage={dashboard.usage}
                    busy={dashboard.busy}
                    onSave={dashboard.savePricing}
                  />
                </Panel>
              </details>
              <button
                className="button"
                onClick={() => {
                  setSelection((current) => ({ ...current, model: dialog.model }));
                  closeDialog();
                  setView("sessions");
                }}
              >
                Inspect sessions
              </button>
            </div>
          )}
        </AppDialog>
      )}
    </div>
  );
}
