import type { Entry } from "./types.ts";
import { fmt } from "./format.ts";
export function usageCsv(entries: Entry[]) {
  const columns = [
    "ts",
    "source",
    "model",
    "provider",
    "project",
    "session",
    "input",
    "output",
    "cacheWrite",
    "cacheRead",
    "reasoning",
    "cost",
    "n",
    "unpriced",
    "cacheSavings",
    "speed",
    "speedPremium",
    "costOrigin",
    "costInput",
    "costOutput",
    "costCacheWrite",
    "costCacheRead",
    "cacheWrite1h"
  ] as const;
  const quote = (value: unknown) => {
    const text = String(value ?? "");
    return '"' + (/^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
  };
  return (
    "\ufeff" +
    columns.join(",") +
    "\r\n" +
    entries.map((entry) => columns.map((key) => quote(entry[key])).join(",")).join("\r\n")
  );
}
export function exportUsage(entries: Entry[]) {
  const blob = new Blob([usageCsv(entries)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `cinder-usage-${fmt.dayKey(new Date())}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
