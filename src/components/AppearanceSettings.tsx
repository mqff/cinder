import { useState, type CSSProperties } from "react";
import type { usePreferences } from "@/hooks/usePreferences";
import { THEMES } from "@/lib/themes";
import { ExpandableList } from "./ExpandableList";
import { Glyph } from "./Glyph";
import { Metadata } from "./Primitives";

export function AppearanceSettings({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const [query, setQuery] = useState("");
  const filtered = THEMES.filter((theme) => theme.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="view-stack appearance-settings">
      <div className="appearance-toolbar">
        <div className="segmented" role="group" aria-label="Color mode">
          {(["system", "dark", "light"] as const).map((mode) => (
            <button
              key={mode}
              aria-label={`${mode === "system" ? "System" : mode === "dark" ? "Dark" : "Light"} mode`}
              aria-pressed={preferences.mode === mode}
              onClick={() => preferences.setMode(mode)}
            >
              {mode === "system" ? "System" : mode === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </div>
        <label className="theme-search">
          <Glyph name="search" size={14} />
          <input
            aria-label="Search themes"
            placeholder="Search themes…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="appearance-selection">
        <Metadata
          items={[
            {
              label: preferences.resolvedMode === "dark" ? "Dark palette" : "Light palette",
              value: THEMES.find((theme) => theme.id === preferences.theme)?.label
            }
          ]}
        />
        <p className="note">Each appearance remembers its own palette.</p>
      </div>
      <ExpandableList key={query} items={filtered}>
        {(visible) => (
          <div className="theme-gallery" aria-label="Theme library">
            {visible.map((theme) => {
              const palette = theme[preferences.resolvedMode];
              const style = {
                "--preview-bg": palette.bg,
                "--preview-surface": palette.surface,
                "--preview-muted": palette.muted,
                "--preview-fg": palette.fg,
                "--preview-accent": palette.brand
              } as CSSProperties;
              return (
                <button
                  className="theme-card"
                  key={theme.id}
                  aria-label={`Use ${theme.label} theme`}
                  aria-pressed={preferences.theme === theme.id}
                  onClick={() => preferences.setTheme(theme.id)}
                >
                  <span className="theme-preview" style={style} aria-hidden="true">
                    <span className="theme-preview-sidebar">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="theme-preview-content">
                      <i />
                      <span>
                        {palette.data.map((color, index) => (
                          <i
                            key={color + index}
                            style={{ backgroundColor: color, height: `${25 + ((index * 29) % 65)}%` }}
                          />
                        ))}
                      </span>
                    </span>
                  </span>
                  <span className="theme-card-label">
                    {theme.label}
                    {preferences.theme === theme.id && <Glyph name="check" size={13} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </ExpandableList>
      {!filtered.length && <p className="note">No matching themes.</p>}
    </div>
  );
}
