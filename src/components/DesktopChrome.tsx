import { useEffect, useState } from "react";
import { Glyph } from "./Glyph";
import { views, type ViewId } from "@/lib/navigation";
import logo from "../../icon/icon.svg";

export function DesktopChrome({
  view,
  onView,
  onSettings,
  onCommands
}: {
  view: ViewId;
  onView: (view: ViewId) => void;
  onSettings: () => void;
  onCommands: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const mac = window.cinder?.platform === "darwin";
  useEffect(() => {
    let alive = true;
    void window.cinder
      ?.isMaximized()
      .then((value) => {
        if (alive) setMaximized(value);
      })
      .catch(() => {});
    const unsubscribe = window.cinder?.onWindowState(setMaximized);
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);
  return (
    <>
      <header className={`titlebar ${mac ? "mac" : ""}`} onDoubleClick={() => void window.cinder?.toggleMaximize()}>
        <img className="brand-mark" src={logo} alt="" width="20" height="20" />
        <strong>Cinder</strong>
        <div className="titlebar-actions">
          <button aria-label="Commands" title={`${mac ? "Cmd" : "Ctrl"}+K`} onClick={onCommands}>
            <Glyph name="search" />
          </button>
          {!mac && (
            <div className="window-controls">
              <button aria-label="Minimize" onClick={() => void window.cinder?.minimize()}>
                <Glyph name="minimize" size={13} />
              </button>
              <button
                aria-label={maximized ? "Restore window" : "Maximize"}
                onClick={() => void window.cinder?.toggleMaximize()}
              >
                <Glyph name={maximized ? "restore" : "maximize"} size={12} />
              </button>
              <button aria-label="Close" className="close-window" onClick={() => void window.cinder?.close()}>
                <Glyph name="close" size={14} />
              </button>
            </div>
          )}
        </div>
      </header>
      <aside className="sidebar">
        <nav aria-label="Main navigation">
          {views.map(([id, label, icon], index) => (
            <button key={id} aria-current={view === id ? "page" : undefined} onClick={() => onView(id)}>
              <Glyph name={icon} />
              <span>{label}</span>
              <kbd>{index + 1}</kbd>
            </button>
          ))}
        </nav>
        <button className="sidebar-settings" onClick={onSettings}>
          <Glyph name="settings" />
          <span>Settings</span>
        </button>
      </aside>
    </>
  );
}
