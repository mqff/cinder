import { useState } from "react";
import { daySeries, hourSeries } from "@/lib/aggregate";
import { fmt } from "@/lib/format";
import { sourceLabel } from "@/lib/navigation";
import type { Summary } from "@/lib/types";
import { Panel, Stat } from "@/components/Primitives";
import { UsageChart } from "@/components/charts/UsageChart";
import { ExpandableList } from "@/components/ExpandableList";

const metrics = ["cost", "tokens", "requests"] as const;
export function Overview({ sum, period, onModel }: { sum: Summary; period: number; onModel: (model: string) => void }) {
  const [metric, setMetric] = useState<(typeof metrics)[number]>("cost");
  const total = sum.totals;
  const value =
    metric === "cost" ? fmt.cost(total) : metric === "tokens" ? fmt.compact(total.tokens) : fmt.int(total.requests);
  const input = total.input + total.cacheWrite + total.cacheRead;
  const providers = [...sum.sources].sort((a, b) => b[metric] - a[metric]);
  const models = [...sum.models].sort((a, b) => b[metric] - a[metric]);
  const maximum = models.reduce((maximum, model) => Math.max(maximum, model[metric]), 0) || 1;
  const costParts = [
    ["Input", sum.costBy.input],
    ["Output", sum.costBy.output],
    ["Cache read", sum.costBy.cacheRead],
    ["Cache write", sum.costBy.cacheWrite],
    ["Other", Math.max(0, total.cost - Object.values(sum.costBy).reduce((sum, cost) => sum + cost, 0))]
  ] as const;
  return (
    <div className="usage-overview">
      <div className="metric-tabs" role="group" aria-label="Usage metric">
        {metrics.map((item) => (
          <button key={item} aria-pressed={metric === item} onClick={() => setMetric(item)}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      <section className="usage-summary">
        <div className="usage-total">
          <div
            className="total-value"
            title={metric === "cost" ? "Reported costs and API-equivalent estimates in USD" : fmt.int(total[metric])}
          >
            {value}
          </div>
          <p className="total-label">
            {metric === "cost" ? "Usage cost" : metric === "tokens" ? "Processed tokens" : "Recorded requests"}
          </p>
          {!!total.unpriced && (
            <p
              className="price-quality"
              title="Requests without a known price contribute tokens, but cannot be included in cost."
            >
              {fmt.int(total.unpriced)} unpriced {total.unpriced === 1 ? "request" : "requests"}
            </p>
          )}
          <div className="provider-totals">
            <ExpandableList items={providers}>
              {(visible) => (
                <div className="provider-total-list">
                  {visible.map((provider, index) => (
                    <div key={provider.name} className="provider-total">
                      <span>
                        <i style={{ background: `var(--data-${(index % 5) + 1})` }} />
                        {sourceLabel(provider.name)}
                      </span>
                      <b>{metric === "cost" ? fmt.cost(provider) : fmt.compact(provider[metric])}</b>
                    </div>
                  ))}
                </div>
              )}
            </ExpandableList>
          </div>
        </div>
        <div className="daily-chart">
          <h2>
            {period === 1 ? "Hourly" : "Daily"} {metric}
          </h2>
          <UsageChart
            points={period === 1 ? hourSeries(sum.byHour) : daySeries(sum.byDay, period)}
            metric={metric}
            interval={period === 1 ? "hour" : "day"}
          />
        </div>
      </section>
      <div className="stats-grid summary-stats">
        <Stat label="Requests" value={fmt.int(total.requests)} detail={`${fmt.int(sum.sessions)} sessions`} />
        <Stat label="Cache hit rate" value={fmt.pct(input ? total.cacheRead / input : 0)} />
        <Stat
          label="Cache savings"
          value={fmt.usd(total.cacheSavings || 0)}
          detail="Estimated from priced cache reads"
        />
        <Stat label="Active days" value={fmt.int(sum.activeDays)} />
      </div>
      <Panel title="Breakdown" hint={`${models.length} models`}>
        <ExpandableList items={models}>
          {(visible) => (
            <div className="model-breakdown">
              {visible.map((model) => (
                <button key={model.name} className="model-row" onClick={() => onModel(model.name)}>
                  <div className="model-row-label">
                    <strong>{model.name}</strong>
                    <span>
                      {fmt.int(model.requests)} {model.requests === 1 ? "request" : "requests"}
                    </span>
                  </div>
                  <div className="model-meter">
                    <i style={{ width: `${(model[metric] / maximum) * 100}%` }} />
                  </div>
                  <b>{metric === "cost" ? fmt.cost(model) : fmt.compact(model[metric])}</b>
                </button>
              ))}
            </div>
          )}
        </ExpandableList>
      </Panel>
      <div className="two-columns">
        <Panel title="Tokens">
          <div className="token-composition">
            {[
              ["Fresh input", total.input],
              ["Output", total.output],
              ["Cache read", total.cacheRead],
              ["Cache write", total.cacheWrite]
            ].map(([label, count]) => (
              <div key={label}>
                <span>{label}</span>
                <b>{fmt.compact(Number(count))}</b>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Cost by token type" hint="USD">
          <div className="token-composition">
            {costParts.map(([label, cost]) => (
              <div key={label}>
                <span>{label}</span>
                <b>{fmt.usd(cost)}</b>
              </div>
            ))}
            <div>
              <span title="Included in the token-category costs above.">Speed premium (included)</span>
              <b>{fmt.usd(total.speedPremium || 0)}</b>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
