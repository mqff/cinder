import { useId, useState, type ReactNode } from "react";

export function ExpandableList<T>({
  items,
  children,
  className = ""
}: {
  items: readonly T[];
  children: (visible: readonly T[]) => ReactNode;
  className?: string;
}) {
  const [limit, setLimit] = useState(5);
  const id = useId();
  const remaining = Math.max(0, items.length - limit);
  return (
    <div className={`expandable-list ${className}`}>
      <div id={id}>{children(items.slice(0, limit))}</div>
      {items.length > 5 && (
        <div className="list-actions">
          {remaining > 0 && (
            <button
              className="list-more"
              aria-expanded={limit > 5}
              aria-controls={id}
              onClick={() => setLimit((current) => current + 50)}
            >
              Show {Math.min(remaining, 50)} more
            </button>
          )}
          {limit > 5 && (
            <button className="list-collapse" aria-controls={id} onClick={() => setLimit(5)}>
              Show fewer
            </button>
          )}
          <span className="list-count">
            {Math.min(limit, items.length)} of {items.length}
          </span>
        </div>
      )}
    </div>
  );
}
