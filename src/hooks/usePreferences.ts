import { useCallback, useEffect, useState } from "react";
import { readPref, writePref } from "@/lib/prefs";
import { applyTheme, paletteOf, resolveMode, THEMES, type Appearance } from "@/lib/themes";
import { readAppearance } from "@/lib/appearance";

export function usePreferences() {
  const [appearance, setAppearance] = useState(readAppearance);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const resolvedMode = resolveMode(appearance.mode, systemDark);
  const theme = appearance.themes[resolvedMode];
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  const [autoRefresh, setAutoRefresh] = useState(() => readPref("auto-refresh") === "true");
  const [period, setPeriod] = useState(() => {
    const saved = readPref("period");
    return saved !== null && [0, 1, 7, 30, 90].includes(Number(saved)) ? Number(saved) : 30;
  });
  useEffect(() => {
    applyTheme(theme, resolvedMode);
    writePref("theme-id", theme);
    writePref("mode", appearance.mode);
    writePref("theme-dark", appearance.themes.dark);
    writePref("theme-light", appearance.themes.light);
    window.cinder?.setBackground(paletteOf(theme, resolvedMode).bg);
  }, [theme, appearance, resolvedMode]);
  useEffect(() => writePref("auto-refresh", String(autoRefresh)), [autoRefresh]);
  useEffect(() => writePref("period", String(period)), [period]);
  const setTheme = useCallback(
    (id: string) => {
      if (THEMES.some((item) => item.id === id))
        setAppearance((previous) => ({ ...previous, themes: { ...previous.themes, [resolvedMode]: id } }));
    },
    [resolvedMode]
  );
  const setMode = useCallback((mode: Appearance) => {
    setAppearance((previous) => ({ ...previous, mode }));
  }, []);
  return {
    theme,
    setTheme,
    mode: appearance.mode,
    resolvedMode,
    setMode,
    autoRefresh,
    setAutoRefresh,
    period,
    setPeriod
  };
}
