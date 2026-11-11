import type { ReactNode } from "react";
import { fmt } from "@/lib/format";
import { ExpandableList } from "./ExpandableList";
export function Panel({
  title,
  hint,
  children,
  className = ""
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-heading">
        <h2>{title}</h2>
        {hint && <div className="panel-hint">{hint}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
export function Stat({ label, value, detail }: { label: string; value: string; detail?: ReactNode }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export function Metadata({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="metadata">
      {items.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <div className="empty-detail">{children}</div>}
    </div>
  );
}
export function ShareBars({
  rows,
  money = false,
  onSelect
}: {
  rows: { name: string; value: number; unpriced?: number }[];
  money?: boolean;
  onSelect?: (name: string) => void;
}) {
  const max = rows.reduce((value, row) => Math.max(value, row.value), 0) || 1;
  const ranked = [...rows].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  if (!rows.length) return <p className="empty-list">None recorded</p>;
  return (
    <ExpandableList items={ranked}>
      {(visible) => (
        <div className="share-bars">
          {visible.map((row, index) => {
            const content = (
              <>
                <span className="share-name" title={row.name}>
                  {row.name}
                </span>
                <span className="share-track">
                  <i style={{ width: `${(row.value / max) * 100}%`, background: `var(--data-${(index % 5) + 1})` }} />
                </span>
                <b>{money ? fmt.cost({ cost: row.value, unpriced: row.unpriced }) : fmt.compact(row.value)}</b>
              </>
            );
            return onSelect ? (
              <button key={row.name} className="share-row" onClick={() => onSelect(row.name)}>
                {content}
              </button>
            ) : (
              <div key={row.name} className="share-row">
                {content}
              </div>
            );
          })}
        </div>
      )}
    </ExpandableList>
  );
}
