import type { LimitAccount, LimitWindow } from "./types";

export function remaining(window: LimitWindow) {
  return Math.max(0, 100 - window.usedPercent);
}
export function windowPace(window: LimitWindow, now: number) {
  const duration = (window.durationMinutes || 0) * 60000;
  const left = Date.parse(window.resetsAt || "") - now;
  if (!(duration > 0) || !Number.isFinite(left) || left <= 0 || left > duration) return null;
  const timeLeft = (left / duration) * 100;
  const gap = remaining(window) - timeLeft;
  return { timeLeft, label: gap < -5 ? "Ahead of pace" : gap > 5 ? "Below pace" : "On pace" };
}
function gates(account: LimitAccount, window: LimitWindow) {
  return account.windows.filter(
    (other) =>
      other.id !== window.id &&
      !other.unit &&
      (other.kind === "weekly" || other.kind === "monthly") &&
      (!other.scope || other.scope === window.scope) &&
      (window.kind === "session" || window.kind === "daily")
  );
}
export function available(account: LimitAccount, window: LimitWindow) {
  return gates(account, window).some((other) => remaining(other) === 0) ? 0 : remaining(window);
}
export function nextRefill(account: LimitAccount, window: LimitWindow, now: number) {
  if (account.stale || account.status !== "ready") return null;
  const relevant = [window, ...gates(account, window)];
  const events = [
    ...new Set(
      relevant.map((row) => Date.parse(row.resetsAt || "")).filter((time) => Number.isFinite(time) && time > now)
    )
  ].sort((a, b) => a - b);
  const current = available(account, window);
  for (const time of events) {
    const left = (row: LimitWindow) =>
      Date.parse(row.resetsAt || "") > now && Date.parse(row.resetsAt || "") <= time ? 100 : remaining(row);
    const after = relevant.slice(1).some((row) => left(row) === 0) ? 0 : left(window);
    if (after > current) return { time, restored: after - current };
  }
  return null;
}
export function poolWindows(accounts: LimitAccount[], now: number) {
  const refillTime = (item: LimitAccount) => {
    const primary =
      item.windows.find((window) => window.kind === "session" && !window.scope) ||
      item.windows.find((window) => window.kind === "session") ||
      item.windows[0];
    return primary ? (nextRefill(item, primary, now)?.time ?? Infinity) : Infinity;
  };
  const ordered = [...accounts].sort((a, b) => refillTime(a) - refillTime(b) || a.id.localeCompare(b.id));
  const groups = new Map<string, { label: string; segments: { account: LimitAccount; window: LimitWindow }[] }>();
  for (const account of ordered) {
    for (const window of account.windows) {
      const key = JSON.stringify([
        window.kind,
        window.scope || "",
        window.durationMinutes || 0,
        window.unit || "",
        window.kind === "other" ? window.id : ""
      ]);
      if (!groups.has(key)) groups.set(key, { label: window.label, segments: [] });
      groups.get(key)!.segments.push({ account, window });
    }
  }
  return [...groups].map(([id, group]) => {
    const refills = group.segments
      .flatMap(({ account, window }) => {
        const refill = nextRefill(account, window, now);
        return refill ? [{ ...refill, accountId: account.id }] : [];
      })
      .sort((a, b) => a.time - b.time);
    const first = refills[0];
    const money = group.segments.every(
      ({ window }) => window.unit === "USD" && window.totalAmount !== undefined && window.usedAmount !== undefined
    );
    const balance = money
      ? group.segments.reduce((sum, { window }) => sum + Math.max(0, window.totalAmount! - window.usedAmount!), 0)
      : null;
    return {
      id,
      ...group,
      balance,
      segments: ordered.map((account) => ({
        account,
        window: group.segments.find((segment) => segment.account.id === account.id)?.window || null
      })),
      remaining:
        group.segments.reduce((sum, item) => sum + available(item.account, item.window), 0) / group.segments.length,
      refill: first
        ? {
            time: first.time,
            restored:
              refills.filter((item) => item.time === first.time).reduce((sum, item) => sum + item.restored, 0) /
              group.segments.length
          }
        : null
    };
  });
}
export function resetLabel(value: string | number, now: number) {
  const time = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(time)) return "Reset time not reported";
  const minutes = Math.ceil((time - now) / 60000);
  if (minutes <= 0) return "Reset time passed";
  if (minutes < 60) return `Resets in ${minutes}m`;
  if (minutes < 1440) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}
