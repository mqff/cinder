import type { CollectResult, PricingRule } from "@/lib/types";
import type { usePreferences } from "@/hooks/usePreferences";
import { fmt } from "@/lib/format";
import { Panel } from "./Primitives";
import { PricingEditor } from "./PricingEditor";
import { ExpandableList } from "./ExpandableList";
import { SensitiveText } from "./SensitiveText";
import { AppearanceSettings } from "./AppearanceSettings";

export function Settings({
  preferences,
  usage,
  busy,
  onPricing
}: {
  preferences: ReturnType<typeof usePreferences>;
  usage: CollectResult | null;
  busy: boolean;
  onPricing: (rules: PricingRule[]) => Promise<void>;
}) {
  const sources = new Map(usage?.sources.map((item) => [item.source, item]));
  const catalog = [...(usage?.catalog || [])].sort(
    (a, b) => (sources.get(b.id)?.entries || 0) - (sources.get(a.id)?.entries || 0) || a.label.localeCompare(b.label)
  );
  return (
    <div className="view-stack">
      <Panel title="Appearance">
        <AppearanceSettings preferences={preferences} />
      </Panel>
      <Panel title="Refresh">
        <div className="setting-row">
          <span>Refresh every minute</span>
          <button
            role="switch"
            aria-label="Refresh every minute"
            aria-checked={preferences.autoRefresh}
            className="switch-control"
            onClick={() => preferences.setAutoRefresh(!preferences.autoRefresh)}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </Panel>
      <Panel title="Sources">
        <ExpandableList items={catalog}>
          {(visible) => (
            <div className="source-catalog">
              {visible.map((item) => {
                const source = sources.get(item.id);
                return (
                  <div key={item.id}>
                    <strong>{item.label}</strong>
                    <span>
                      {source?.entries
                        ? `${fmt.int(source.entries)} ${source.entries === 1 ? "record" : "records"}, ${source.files} ${source.files === 1 ? "file" : "files"}`
                        : "No records"}
                    </span>
                    {source?.dir && (
                      <code>
                        <SensitiveText value={source.dir} label="Source directory" />
                      </code>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ExpandableList>
      </Panel>
      <Panel title="Model pricing">
        <PricingEditor usage={usage} busy={busy} onSave={onPricing} />
      </Panel>
      <Panel title="Shortcuts">
        <dl className="shortcut-list">
          <dt>Switch view</dt>
          <dd>Ctrl / Cmd + 1–9</dd>
          <dt>Refresh</dt>
          <dd>Ctrl / Cmd + R</dd>
          <dt>Commands</dt>
          <dd>Ctrl / Cmd + K</dd>
          <dt>Change theme</dt>
          <dd>Ctrl / Cmd + Alt + A</dd>
          <dt>Cycle appearance</dt>
          <dd>Ctrl / Cmd + Alt + Shift + A</dd>
        </dl>
      </Panel>
    </div>
  );
}
