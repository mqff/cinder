import { useState } from "react";
import { views, type ViewId } from "@/lib/navigation";
import type { IconKey } from "@/lib/icons";
import { Glyph } from "./Glyph";

export function Commands({
  onView,
  onThemes,
  onSettings
}: {
  onView: (view: ViewId) => void;
  onThemes: () => void;
  onSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const actions: { label: string; keywords: string; icon: IconKey; run: () => void }[] = [
    ...views.map(([id, label, icon]) => ({ label, keywords: label, icon, run: () => onView(id) })),
    { label: "Change theme", keywords: "change theme appearance", icon: "settings", run: onThemes },
    { label: "Settings", keywords: "settings", icon: "settings", run: onSettings }
  ];
  const filtered = actions.filter((action) => action.keywords.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".command-list button")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          index < 0
            ? event.key === "ArrowDown"
              ? 0
              : buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      <input
        data-autofocus
        className="command-search"
        aria-label="Search commands"
        placeholder="Search commands…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="command-list">
        {filtered.map((action) => (
          <button key={action.label} onClick={action.run}>
            <Glyph name={action.icon} />
            {action.label}
          </button>
        ))}
        {!filtered.length && <p className="note">No matching commands.</p>}
      </div>
    </div>
  );
}
