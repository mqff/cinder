import { test } from "node:test";
import assert from "node:assert/strict";
import { available, nextRefill, poolWindows, remaining, resetLabel, windowPace } from "../src/lib/limits.ts";
import type { LimitAccount, LimitWindow } from "../src/lib/types.ts";
const now = Date.parse("2026-11-11T12:00:00Z");
const session: LimitWindow = {
  id: "session",
  label: "5-hour",
  kind: "session",
  durationMinutes: 300,
  usedPercent: 30,
  resetsAt: "2026-11-11T16:00:00Z"
};
const weekly: LimitWindow = {
  id: "weekly",
  label: "Weekly",
  kind: "weekly",
  usedPercent: 100,
  resetsAt: "2026-11-11T14:00:00Z"
};
test("quota pace compares consumption with elapsed time and omits unknown or expired windows", () => {
  assert.deepEqual(windowPace(session, now), { timeLeft: 80, label: "Ahead of pace" });
  assert.deepEqual(windowPace({ ...session, usedPercent: 20 }, now), { timeLeft: 80, label: "On pace" });
  assert.deepEqual(windowPace({ ...session, usedPercent: 0 }, now), { timeLeft: 80, label: "Below pace" });
  assert.equal(windowPace({ ...session, durationMinutes: undefined }, now), null);
  assert.equal(windowPace({ ...session, resetsAt: "invalid" }, now), null);
  assert.equal(windowPace(session, Date.parse(session.resetsAt!)), null);
  assert.equal(windowPace(session, now - 2 * 3600000), null);
});
test("pooled dollar balances preserve zero and stay unknown when an amount is missing", () => {
  const credit: LimitWindow = {
    id: "paid-credits",
    label: "Paid credits",
    kind: "other",
    unit: "USD",
    scope: "paid-credits",
    usedPercent: 25,
    totalAmount: 20,
    usedAmount: 5
  };
  assert.equal(
    poolWindows([account([credit]), { ...account([{ ...credit, totalAmount: 10, usedAmount: 2 }]), id: "b" }], now)[0]
      .balance,
    23
  );
  assert.equal(poolWindows([account([{ ...credit, totalAmount: 0, usedAmount: 0 }])], now)[0].balance, 0);
  assert.equal(poolWindows([account([{ ...credit, totalAmount: undefined }])], now)[0].balance, null);
  assert.equal(poolWindows([account([session])], now)[0].balance, null);
});
const account = (windows: LimitWindow[]): LimitAccount => ({
  id: "a",
  provider: "codex",
  label: "Fixture",
  status: "ready",
  checkedAt: new Date(now).toISOString(),
  windows
});
test("an exhausted week gates a session and its refill restores only the session's unused portion", () => {
  const item = account([session, weekly]);
  assert.equal(remaining(session), 70);
  assert.equal(available(item, session), 0);
  assert.deepEqual(nextRefill(item, session, now), { time: Date.parse(weekly.resetsAt!), restored: 70 });
  assert.equal(nextRefill(item, session, Date.parse("2026-11-11T14:01:00Z")), null);
});
test("a session refill behind an exhausted week waits until the week makes it usable", () => {
  const earlier = { ...session, resetsAt: "2026-11-11T13:00:00Z" };
  assert.deepEqual(nextRefill(account([earlier, weekly]), earlier, now), {
    time: Date.parse(weekly.resetsAt!),
    restored: 100
  });
});
test("a model-scoped week cannot block an unrelated account-wide session", () => {
  const item = account([session, { ...weekly, scope: "other-model" }]);
  assert.equal(available(item, session), 70);
});
test("stale quotas and past reset timestamps never produce an invented refill", () => {
  assert.equal(nextRefill({ ...account([session]), stale: true }, session, now), null);
  const past = { ...session, resetsAt: "2026-11-10" };
  assert.equal(nextRefill(account([past]), past, now), null);
  assert.match(resetLabel(past.resetsAt, now), /passed/);
  assert.match(resetLabel("invalid", now), /not reported/);
});
test("pooled account segments stay ordered across windows and pooled restoration is normalized", () => {
  const a = account([session, weekly]);
  const b = {
    ...account([
      { ...session, usedPercent: 0 },
      { ...weekly, usedPercent: 0 }
    ]),
    id: "b"
  };
  const pools = poolWindows([b, a], now);
  assert.deepEqual(
    pools.map((pool) => pool.segments.map((segment) => segment.account.id)),
    [
      ["a", "b"],
      ["a", "b"]
    ]
  );
  assert.equal(pools[0].remaining, 50);
  assert.equal(pools[0].refill?.restored, 35);
});
test("an account that does not report one window keeps an empty segment in that column", () => {
  const pools = poolWindows([account([session, weekly]), { ...account([weekly]), id: "b" }], now);
  assert.equal(pools[0].segments.length, 2);
  assert.equal(pools[0].segments[1].window, null);
  assert.equal(pools[0].remaining, 0);
});
