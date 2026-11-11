import { readPref } from "./prefs.ts";
import { DEFAULT_THEME, THEMES, type Appearance } from "./themes.ts";

export function readAppearance() {
  const savedMode = readPref("mode");
  const mode: Appearance = savedMode === "dark" || savedMode === "light" ? savedMode : "system";
  const savedTheme = readPref("theme-id");
  const theme = (value: string | null) => (THEMES.some((item) => item.id === value) ? value! : DEFAULT_THEME);
  return {
    mode,
    themes: {
      dark: theme(readPref("theme-dark") || savedTheme),
      light: theme(readPref("theme-light") || savedTheme)
    }
  };
}
