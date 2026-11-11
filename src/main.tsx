import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyTheme, resolveMode } from "./lib/themes";
import { readAppearance } from "./lib/appearance";
import "./globals.css";
const appearance = readAppearance();
const mode = resolveMode(appearance.mode, window.matchMedia("(prefers-color-scheme: dark)").matches);
applyTheme(appearance.themes[mode], mode);
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
