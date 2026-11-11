import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CollectResult, PricingRule } from "@/lib/types";
import { sourceLabel } from "@/lib/navigation";
import { Choice } from "./Choice";
import { ExpandableList } from "./ExpandableList";

const fields = [
  ["input", "Input"],
  ["output", "Output"],
  ["cacheRead", "Cache read"],
  ["cacheWrite", "Cache write (5 min)"],
  ["cacheWrite1h", "Cache write (1 hour)"]
] as const;
type Prices = Record<(typeof fields)[number][0], string>;
const blankPrices: Prices = { input: "", output: "", cacheRead: "", cacheWrite: "", cacheWrite1h: "" };

export function PricingEditor({
  usage,
  model: initial = "",
  busy,
  onSave
}: {
  usage: CollectResult | null;
  model?: string;
  busy: boolean;
  onSave: (rules: PricingRule[]) => Promise<void>;
}) {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [model, setModel] = useState(initial);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [prices, setPrices] = useState(blankPrices);
  const [exclude, setExclude] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [customName, setCustomName] = useState(false);
  useEffect(() => {
    void window.cinder
      ?.readPricing()
      .then((result) => {
        setRules(result);
        setLoaded(true);
      })
      .catch(() => setError("Pricing rules could not be loaded."));
  }, []);
  const models = useMemo(
    () =>
      [
        ...new Set([
          ...(usage?.entries.map((entry) => entry.model) || []),
          ...rules.map((rule) => rule.model),
          ...(model ? [model] : [])
        ])
      ]
        .sort()
        .map((name) => ({ value: name, label: name })),
    [usage, rules, model]
  );
  const current = rules.find(
    (rule) => rule.model.toLowerCase() === model.trim().toLowerCase() && (rule.source || "") === source
  );
  useEffect(() => {
    setPrices(
      Object.fromEntries(
        fields.map(([key]) => [key, current?.[key] === undefined ? "" : String(current[key])])
      ) as Prices
    );
    setTarget(current?.target || "");
    setExclude(current?.exclude || false);
  }, [current, model, source]);
  useEffect(() => setSaved(false), [model, source]);
  const disabled = busy || saving || !loaded;
  async function save(next: PricingRule[]) {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await onSave(next);
      setRules(next);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pricing could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!model.trim()) {
      setError("Choose or enter a model name.");
      return;
    }
    const rule: PricingRule = {
      model: model.trim(),
      ...(source ? { source } : {}),
      ...(target.trim() ? { target: target.trim() } : {}),
      ...(exclude ? { exclude } : {})
    };
    for (const [key] of fields) {
      if (!prices[key].trim()) continue;
      const value = Number(prices[key]);
      if (!Number.isFinite(value) || value < 0 || value > 1000000) {
        setError("Enter a non-negative price up to 1,000,000 USD per million tokens.");
        return;
      }
      rule[key] = value;
    }
    void save([...rules.filter((item) => item !== current), rule]);
  }
  return (
    <div className="pricing-editor">
      <p className="note">
        USD per million tokens. Blank fields inherit the price catalog; new models use input pricing for cache. 0 means
        free. Reported costs take precedence. Excluded models stay in their original logs and return when the rule is
        removed.
      </p>
      <form onSubmit={submit} className="view-stack">
        <div className="pricing-model-controls">
          {customName ? (
            <label>
              Model name
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Exact model identifier"
                maxLength={256}
              />
            </label>
          ) : (
            <label>
              Model
              <Choice
                label="Pricing model"
                value={model}
                onChange={setModel}
                options={[{ value: "", label: "Choose a model" }, ...models]}
              />
            </label>
          )}
          <label>
            Applies to
            <Choice
              label="Pricing tool"
              value={source}
              onChange={setSource}
              options={[
                { value: "", label: "All tools" },
                ...(usage?.catalog || []).map((item) => ({ value: item.id, label: item.label }))
              ]}
            />
          </label>
          <button className="text-button" type="button" onClick={() => setCustomName(!customName)}>
            {customName ? "Choose recorded model" : "Enter a model name"}
          </button>
        </div>
        <label className="pricing-alias">
          Use catalog price for
          <input
            value={target}
            onChange={(event) => {
              setSaved(false);
              setTarget(event.target.value);
            }}
            placeholder="Optional model alias, e.g. claude-sonnet-4-6"
            maxLength={256}
          />
        </label>
        <div className="pricing-fields">
          {fields.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                aria-label={`${label} price`}
                type="number"
                min="0"
                max="1000000"
                step="any"
                value={prices[key]}
                onChange={(event) => {
                  setSaved(false);
                  setPrices({ ...prices, [key]: event.target.value });
                }}
                placeholder="Catalog"
              />
            </label>
          ))}
        </div>
        <label className="pricing-exclude">
          <input
            type="checkbox"
            checked={exclude}
            onChange={(event) => {
              setSaved(false);
              setExclude(event.target.checked);
            }}
          />
          Exclude this model from usage statistics
        </label>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="note">
            Pricing saved and usage recalculated.
          </p>
        )}
        <div className="inline-controls">
          <button className="button primary" disabled={disabled || !model.trim()} type="submit">
            {saving ? "Recalculating…" : "Save and recalculate"}
          </button>
          {current && (
            <button
              className="button"
              disabled={disabled}
              type="button"
              onClick={() => void save(rules.filter((rule) => rule !== current))}
            >
              Restore catalog pricing
            </button>
          )}
        </div>
      </form>
      {rules.length > 0 && (
        <div className="pricing-rules">
          <h3>Saved rules</h3>
          <ExpandableList items={rules}>
            {(visible) =>
              visible.map((rule) => (
                <div className="pricing-rule" key={`${rule.source}:${rule.model}`}>
                  <button
                    onClick={() => {
                      setModel(rule.model);
                      setSource(rule.source || "");
                    }}
                  >
                    <strong>{rule.model}</strong>
                    <small>{rule.source ? sourceLabel(rule.source) : "All tools"}</small>
                    <small>
                      {rule.exclude ? "Excluded" : rule.target ? `Catalog price: ${rule.target}` : "Custom prices"}
                    </small>
                  </button>
                  <button
                    className="text-button"
                    disabled={disabled}
                    onClick={() => void save(rules.filter((item) => item !== rule))}
                  >
                    Remove
                  </button>
                </div>
              ))
            }
          </ExpandableList>
          <button className="text-button" disabled={disabled} onClick={() => void save([])}>
            Reset all pricing rules
          </button>
        </div>
      )}
    </div>
  );
}
