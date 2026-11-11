const number = new Intl.NumberFormat("en-US");
const short = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const formatMoney = (value: number) =>
  value > 0 && value < 0.01
    ? value < 0.0001
      ? "<$0.0001"
      : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value)
    : money.format(value || 0);
export const fmt = {
  plan: (value: string) =>
    value
      .replace(/[_-]+/g, " ")
      .replace(/\b(?:api|ai)\b/gi, (word) => word.toUpperCase())
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
  cost: (value: { cost: number; unpriced?: number }) =>
    value.unpriced ? (value.cost > 0 ? `≥${formatMoney(value.cost)}` : "Unpriced") : formatMoney(value.cost),
  int: (value: number) => number.format(Math.round(value || 0)),
  compact: (value: number) => short.format(value || 0),
  usd: formatMoney,
  pct: (value: number) =>
    new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value || 0),
  dayKey(value: Date | string | number) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  },
  dayLabel: (key: string) =>
    new Date(key + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  monthShort: (date: Date) => date.toLocaleDateString("en-US", { month: "short" }),
  modelShort: (model: string) =>
    model === "cursor-auto" || model === "default"
      ? "Auto"
      : (model || "unknown")
          .replace(/^anthropic\//, "")
          .replace(/^claude-/, "")
          .replace(/-\d{8}$/, "")
          .replace(/-(?:high-thinking|thinking|build)$/, "")
};
