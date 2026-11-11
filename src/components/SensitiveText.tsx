import { useState } from "react";

export function SensitiveText({ value, label }: { value: string; label: string }) {
  const [visibleValue, setVisibleValue] = useState<string | null>(null);
  const revealed = visibleValue === value;
  return (
    <button
      type="button"
      className="sensitive-text"
      aria-label={`${revealed ? "Hide" : "Reveal"} ${label.toLowerCase()}`}
      aria-pressed={revealed}
      title={`Click to ${revealed ? "hide" : "reveal"} ${label.toLowerCase()}`}
      onClick={() => setVisibleValue(revealed ? null : value)}
    >
      <span className={revealed ? "" : "sensitive-text-hidden"}>
        {revealed ? value : value.replace(/[^\s@./\\:_-]/g, "x")}
      </span>
    </button>
  );
}
