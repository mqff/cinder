import { useMemo, useRef, useState } from "react";
import type { CursorUsageResult } from "@/lib/types";
import { summarize, daySeries, blank } from "@/lib/aggregate";
import { exportUsage } from "@/lib/export";
import { fmt } from "@/lib/format";
import { Choice } from "./Choice";
import { Panel, ShareBars, Stat, Metadata } from "./Primitives";
import { UsageChart } from "./charts/UsageChart";

export function CursorAccountUsage({ accountId }: { accountId: string }) {
  const [data, setData] = useState<CursorUsageResult | null>(null);
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const summary = useMemo(() => summarize(data?.entries || []), [data]);
  const points = useMemo(() => {
    if (!data) return [];
    const series = new Map(summary.byDay),
      first = fmt.dayKey(new Date(data.from));
    if (!series.has(first)) series.set(first, blank());
    return daySeries(series, 0, new Date(data.until));
  }, [data, summary]);
  async function load(period = days, force = false) {
    if (!window.cinder || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await window.cinder.cursorAccountUsage({ accountId, days: Number(period), force });
      if (result.error) throw new Error(result.error);
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cursor account usage could not be read.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Panel title="Account usage" hint="Cursor billing API">
      <div className="view-stack cursor-account-usage">
        <p className="note">
          Token counts and costs reported by Cursor. Kept separate from local request counts to avoid double counting.
        </p>
        <fieldset className="account-usage-controls" disabled={busy}>
          <Choice
            label="Cursor account period"
            value={days}
            onChange={(value) => {
              const reload = !!data;
              setData(null);
              setDays(value);
              if (reload) void load(value);
            }}
            options={[7, 30, 90].map((value) => ({ value: String(value), label: `Last ${value} days` }))}
          />
          <button className="button" onClick={() => void load(days, true)}>
            {busy ? "Reading billing events…" : data ? "Refresh account usage" : "Load account usage"}
          </button>
          {data && (
            <button className="button" disabled={!data.entries.length} onClick={() => exportUsage(data.entries)}>
              Export CSV
            </button>
          )}
        </fieldset>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {data && (
          <>
            <Metadata
              items={[
                { label: "From", value: new Date(data.from).toLocaleString() },
                { label: "Until", value: new Date(data.until).toLocaleString() }
              ]}
            />
            {!!data.omitted && <p className="note">{fmt.int(data.omitted)} events without token usage</p>}
            <div className="stats-grid">
              <Stat label="Tokens" value={fmt.compact(summary.totals.tokens)} />
              <Stat label="Requests" value={fmt.int(summary.count)} />
              <Stat label="Cost" value={fmt.cost(summary.totals)} />
              <Stat label="Cache reads" value={fmt.compact(summary.totals.cacheRead)} />
            </div>
            <UsageChart points={points} metric="tokens" />
            <ShareBars
              rows={summary.models.map((model) => ({ name: model.name, value: model.cost, unpriced: model.unpriced }))}
              money
            />
            <p className="note">
              Reported costs take precedence; missing costs use catalog estimates. These figures describe account usage;
              your subscription invoice is separate.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
