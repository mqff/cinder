const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { percent, iso, window, account, fingerprint, requestJson } = require("../main/limits/common");
const { codexWindows, readCodex, useCodexReset } = require("../main/limits/codex");
const { withCodex, codexCommand } = require("../main/limits/codex-rpc");
const { grokWindows, readGrok } = require("../main/limits/grok");
const { cursorWindows, readCursor } = require("../main/limits/cursor");
const { claudeWindows, claudeCredits, readClaude, useClaudeReset } = require("../main/limits/claude");
const { antigravityWindows, googleAccessToken } = require("../main/limits/antigravity");
const { openCodeWindows, scheduledReset, readOpenCode } = require("../main/limits/opencode");
const { addProfile, removeProfile, savedProfiles, validProfile } = require("../main/limits");
const { createLimitsService } = require("../main/limits-service");
const { validLimits } = require("../main/contracts");
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinder-limits-test-"));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function cleanEnv(t, keys) {
  for (const key of keys) {
    const old = process.env[key];
    delete process.env[key];
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
  }
}
const time = "2026-11-11T12:00:00.000Z";
const snapshot = () => ({
  checkedAt: time,
  accounts: [
    account("codex", "fixture", {
      status: "ready",
      checkedAt: time,
      windows: [window("weekly", "Weekly", 30, { kind: "weekly", resetsAt: "2026-11-14" })]
    })
  ]
});
test("quotas retain unknown values, clamp finite percentages and normalize seconds, milliseconds and ISO dates", () => {
  for (const value of [null, undefined, "0", NaN, Infinity]) assert.equal(percent(value), null);
  assert.equal(percent(-5), 0);
  assert.equal(percent(120), 100);
  assert.equal(window("x", "X", null), null);
  assert.equal(iso(1794398400), time);
  assert.equal(iso("1794398400000"), time);
  assert.equal(iso("2026-11-11T12:00:00Z"), time);
  for (const value of [null, {}, "bad", 0]) assert.equal(iso(value), undefined);
});
test("Codex uses the reported duration rather than treating primary as a five-hour window", () => {
  const rows = codexWindows({
    rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: 1794398400 } },
      model: { limitName: "Special model", primary: { usedPercent: 0, windowDurationMins: 300 } }
    }
  });
  assert.equal(rows[0].kind, "weekly");
  assert.equal(rows[0].resetsAt, time);
  assert.equal(rows[1].kind, "session");
  assert.equal(rows[1].scope, "model");
});
test("Codex read probes only account methods and retains credit expiry without exposing raw credit ids", async () => {
  const calls = [];
  const result = await readCodex("fixture", async (_home, run) =>
    run(async (method) => {
      calls.push(method);
      return method === "account/read"
        ? { account: { type: "chatgpt", email: "dev@example.test", planType: "pro" } }
        : {
            rateLimits: { primary: { usedPercent: 1, windowDurationMins: 300 } },
            rateLimitResetCredits: {
              availableCount: 2,
              credits: [{ id: "private-credit", status: "available", expiresAt: 1794398400 }]
            }
          };
    })
  );
  assert.deepEqual(calls, ["account/read", "account/rateLimits/read"]);
  assert.equal(result.resetCredits.available, 2);
  assert.equal(result.resetCredits.nextExpiresAt, time);
  assert.ok(!JSON.stringify(result).includes("private-credit"));
});
test("Codex reset checks account identity, banked credits and persists an intent before sending an idempotent request", async () => {
  const methods = [],
    input = { accountId: fingerprint("codex", "dev@example.test"), requestId: "070d03ed-6cbe-4b16-b00c-08e988c255b6" };
  let credited = true,
    intent = false;
  const rpc = async (_root, run) =>
    run(async (method, params) => {
      methods.push(method);
      if (method === "account/read") return { account: { type: "chatgpt", email: "dev@example.test" } };
      if (method === "account/rateLimits/read")
        return { rateLimits: {}, rateLimitResetCredits: { availableCount: credited ? 1 : 0 } };
      assert.equal(method, "account/rateLimitResetCredit/consume");
      assert.equal(intent, true);
      assert.deepEqual(params, { idempotencyKey: input.requestId });
      credited = false;
      return { ordinaryUsageAllowed: true };
    });
  const redeemed = await useCodexReset("fixture", input, rpc, () => {
    intent = true;
  });
  assert.equal(redeemed.ordinaryUsageAllowed, true);
  assert.equal(methods.filter((method) => method.endsWith("/consume")).length, 1);
  await assert.rejects(useCodexReset("fixture", input, rpc), /no available reset credit/);
  await assert.rejects(useCodexReset("fixture", { ...input, accountId: "other" }, rpc), /account changed/);
  await useCodexReset("fixture", { ...input, retry: true }, rpc);
  assert.equal(methods.filter((method) => method.endsWith("/consume")).length, 2);
});
test("Codex stdio RPC accepts fragmented replies and always closes the subprocess", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = 0;
  const methods = [];
  child.kill = () => {
    killed++;
  };
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      const request = JSON.parse(chunk);
      methods.push(request.method);
      if (request.id) {
        const line = JSON.stringify({ id: request.id, result: { ok: true } }) + "\n";
        child.stdout.write(line.slice(0, 10));
        child.stdout.write(line.slice(10));
      }
      done();
    }
  });
  const result = await withCodex("fixture", (request) => request("account/read", {}), {
    command: { file: "fixture", args: [] },
    spawn: () => child
  });
  assert.equal(result.ok, true);
  assert.equal(killed, 1);
  assert.deepEqual(methods, ["initialize", "initialized", "account/read"]);
});
test("Codex RPC times out an unanswered initialize and never starts a thread", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  await assert.rejects(
    withCodex("fixture", () => assert.fail("Must not run"), {
      command: { file: "fixture", args: [] },
      spawn: () => child,
      timeout: 10
    }),
    /did not answer/
  );
  assert.equal(codexCommand({ CINDER_CODEX_BIN: process.execPath, PATH: "" }).file, process.execPath);
});
test("provider request failures redact bodies and credentials and prohibit redirects", async () => {
  await assert.rejects(
    requestJson("https://provider.test", {}, async (_url, options) => {
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      return { ok: false, status: 401, text: () => "secret token" };
    }),
    (error) => error.code === "auth" && !error.message.includes("secret")
  );
  await assert.rejects(
    requestJson("https://provider.test", {}, async () => {
      throw new Error("Bearer private-token");
    }),
    (error) => !error.message.includes("private-token")
  );
  await assert.rejects(
    requestJson("https://provider.test", {}, async () => ({ ok: true, text: async () => "private-invalid-json" })),
    /invalid response/
  );
});
test("Grok omission means unused only for a valid reported billing period", () => {
  assert.deepEqual(grokWindows({}), []);
  const [row] = grokWindows({
    config: { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-11-07", end: "2026-11-14" } }
  });
  assert.equal(row.usedPercent, 0);
  assert.equal(row.kind, "weekly");
});
test("Cursor exposes total, Auto and API windows; Claude retains model quotas and extra-usage budget", () => {
  const cursor = cursorWindows({
    billingCycleEnd: "1794398400000",
    planUsage: { totalPercentUsed: 0, autoPercentUsed: 20 }
  });
  assert.equal(cursor.length, 2);
  assert.equal(cursor[0].resetsAt, time);
  assert.equal(cursor[1].scope, "autoPercentUsed");
  const claude = claudeWindows({
    five_hour: { utilization: 3, resets_at: time },
    seven_day: { utilization: 100 },
    seven_day_sonnet: { utilization: 9 },
    model_scoped: [{ display_name: "Sonnet", utilization: 20 }],
    extra_usage: { is_enabled: true, used_credits: 150, monthly_limit: 1000 }
  });
  assert.equal(claude.length, 4);
  assert.equal(claude[2].scope, "sonnet");
  assert.equal(claude[2].usedPercent, 20);
  assert.equal(claude[3].usedPercent, 15);
  assert.equal(claude[3].totalAmount, undefined);
});
test("Antigravity ignores disabled quotas and suppresses untouched moving reset timestamps", () => {
  const rows = antigravityWindows(
    {
      groups: [],
      buckets: [
        { bucketId: "gemini-session", window: "5h", remainingFraction: 1, resetTime: "2026-11-11T17:00:00Z" },
        { bucketId: "disabled", disabled: true, remainingFraction: 0 }
      ]
    },
    Date.parse(time)
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].resetsAt, undefined);
  const token = "ya29.synthetic-token-for-unit-test-only";
  assert.equal(googleAccessToken(Buffer.from(Buffer.from(token).toString("base64"))), token);
});
test("OpenCode Go preserves rolling, weekly and monthly reset windows", () => {
  const rows = openCodeWindows({
    usage: { rolling: { percent: 0, resetsAt: 1794398400 }, weekly: { percent: 40 }, monthly: { percent: 100 } }
  });
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["session", "weekly", "monthly"]
  );
  assert.equal(rows[0].resetsAt, time);
});
test("scheduled API-key budgets reset on UTC boundaries including Sunday, Monday and year end", () => {
  assert.equal(scheduledReset("weekly", new Date("2026-11-08T12:00:00Z")), "2026-11-09T00:00:00.000Z");
  assert.equal(scheduledReset("weekly", new Date("2026-11-09T00:00:00Z")), "2026-11-16T00:00:00.000Z");
  assert.equal(scheduledReset("monthly", new Date("2026-12-31T12:00:00Z")), "2027-01-01T00:00:00.000Z");
  assert.equal(scheduledReset("daily", new Date(time)), "2026-11-12T00:00:00.000Z");
  assert.equal(scheduledReset(null), undefined);
});
test("readers use only their default credential issuer and reject custom-endpoint credential mixing", async (t) => {
  const dir = temporary(t);
  cleanEnv(t, [
    "XAI_API_KEY",
    "GROK_AUTH",
    "GROK_CONFIG",
    "GROK_CONFIG_PATH",
    "CURSOR_AUTH_TOKEN",
    "CURSOR_API_KEY",
    "CURSOR_API_ENDPOINT"
  ]);
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ "https://unknown.test": { key: "never-send" } }));
  assert.equal((await readGrok(dir, () => assert.fail("No default credential"))).status, "unavailable");
  process.env.CURSOR_API_ENDPOINT = "https://custom.test";
  process.env.CURSOR_AUTH_TOKEN = "never-send";
  assert.equal(
    (
      await readCursor(
        dir,
        () => assert.fail("No credential mixing"),
        async () => []
      )
    ).status,
    "unavailable"
  );
});
test("OpenRouter reader reports paid credits and a key budget without leaking the API key", async (t) => {
  const dir = temporary(t);
  cleanEnv(t, ["OPENCODE_AUTH_CONTENT", "OPENCODE_API_KEY"]);
  fs.writeFileSync(
    path.join(dir, "auth.json"),
    JSON.stringify({ openrouter: { type: "api", key: "unit-test-secret" } })
  );
  const result = await readOpenCode(dir, async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer unit-test-secret");
    return url.endsWith("/key")
      ? { data: { limit: 20, limit_remaining: 15, limit_reset: "daily" } }
      : { data: { total_credits: 30, total_usage: 10 } };
  });
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[0].usedPercent, 25);
  assert.equal(result.windows[1].unit, "USD");
  assert.ok(!JSON.stringify(result).includes("unit-test-secret"));
});
test("limits coalesce checks, throttle automatic failures, allow forced refresh and retain stale last-known quotas", async (t) => {
  const dir = temporary(t);
  let checks = 0,
    timeNow = Date.parse(time),
    response = snapshot();
  const service = createLimitsService({
    dir,
    now: () => timeNow,
    pool: {
      run: async () => {
        checks++;
        return response;
      }
    }
  });
  const first = service.read();
  assert.equal(service.read(), first);
  await first;
  await service.read();
  assert.equal(checks, 1);
  response = {
    ...snapshot(),
    checkedAt: "2026-11-11T12:01:00Z",
    accounts: snapshot().accounts.map((item) => ({ ...item, status: "error", windows: [], message: "Offline" }))
  };
  const stale = await service.refresh();
  assert.equal(stale.accounts[0].stale, true);
  assert.equal(stale.accounts[0].windows[0].usedPercent, 30);
  response = { error: "Worker stopped" };
  await service.refresh();
  await service.read();
  assert.equal(checks, 3);
  timeNow += 300001;
  await service.read();
  assert.equal(checks, 4);
  assert.equal(service.snapshot().accounts[0].stale, true);
  assert.equal(validLimits({ ...snapshot(), accounts: [{ ...snapshot().accounts[0], resetCredits: null }] }), false);
  assert.equal(
    validLimits({
      ...snapshot(),
      accounts: [{ ...snapshot().accounts[0], windows: [window("x", "X", 1, { usedAmount: 2 })] }]
    }),
    true
  );
});
test("account directory references are validated, deduplicated and removable without deleting account data", (t) => {
  const dir = temporary(t),
    root = path.join(dir, "account");
  fs.mkdirSync(root);
  assert.equal(validProfile({ provider: "codex", root }), true);
  assert.equal(validProfile({ provider: "codex", root: "relative" }), false);
  addProfile(dir, { provider: "codex", root });
  addProfile(dir, { provider: "codex", root });
  assert.equal(savedProfiles(dir).length, 1);
  removeProfile(dir, { provider: "codex", root });
  assert.equal(savedProfiles(dir).length, 0);
  assert.equal(fs.statSync(root).isDirectory(), true);
});
test("Claude banked resets retain their types and omit expired, paused or unusable grants", () => {
  const base = { resets_left: 2, usable_now: true, ends_at: "2026-11-20T12:00:00Z" };
  const result = claudeCredits(
    {
      cedar_ember: {
        eligible: true,
        next_grant_id: "session",
        grants: [
          { ...base, id: "session", clears: ["five_hour"] },
          { ...base, id: "fable", gives_back_weekly: true },
          { ...base, id: "full", type: "full" },
          { ...base, id: "expired", ends_at: "2026-11-10T12:00:00Z" },
          { ...base, id: "paused", paused: true },
          { ...base, id: "unknown", usable_now: false },
          { ...base, id: "malformed/id" }
        ]
      }
    },
    true,
    Date.parse(time)
  );
  assert.equal(result.available, 6);
  assert.deepEqual(
    result.options.map((item) => item.kind),
    ["session", "fable", "full"]
  );
  assert.equal(result.nextExpiresAt, "2026-11-20T12:00:00.000Z");
  assert.ok(!JSON.stringify(result).includes('"id":'));
});
test("a reset cannot reach a worker before the account has a displayed quota snapshot", async (t) => {
  const service = createLimitsService({
    dir: temporary(t),
    pool: { run: () => assert.fail("No consuming request before a snapshot") }
  });
  await assert.rejects(
    service.consume({ accountId: "a".repeat(24), requestId: "070d03ed-6cbe-4b16-b00c-08e988c255b6" }),
    /Refresh Limits/
  );
});
test("Claude reset redeems exactly the chosen grant, checks the account and reuses the original grant on retry", async (t) => {
  const dir = temporary(t);
  cleanEnv(t, ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]);
  fs.writeFileSync(
    path.join(dir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "unit-test-token",
        refreshToken: "unit-test-refresh",
        expiresAt: Date.now() + 100000,
        subscriptionType: "max"
      }
    })
  );
  fs.writeFileSync(
    path.join(dir, ".claude.json"),
    JSON.stringify({ oauthAccount: { emailAddress: "dev@example.test", organizationUuid: "fixture-org" } })
  );
  let claimed = false,
    intent;
  const request = async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer unit-test-token");
    if (url.includes("/reset_rate_limits")) {
      assert.equal(intent.grantId, "weekly-credit");
      assert.deepEqual(JSON.parse(options.body), {
        program: "cedar_ember",
        grant_id: "weekly-credit",
        request_id: "same-request"
      });
      claimed = true;
      return { result: "reset" };
    }
    return {
      five_hour: { utilization: claimed ? 0 : 100 },
      cedar_ember: {
        eligible: true,
        next_grant_id: "session-credit",
        grants: claimed
          ? []
          : [
              { id: "session-credit", type: "session", resets_left: 1, usable_now: true },
              { id: "weekly-credit", type: "weekly", resets_left: 1, usable_now: true }
            ]
      }
    };
  };
  const before = await readClaude(dir, request);
  assert.equal(before.resetCredits.available, 2);
  const input = { accountId: before.id, requestId: "same-request", resetKind: "weekly" };
  await assert.rejects(useClaudeReset(dir, { ...input, accountId: "different" }, request), /account changed/);
  const after = await useClaudeReset(dir, input, request, (value) => {
    intent = value;
  });
  assert.equal(after.windows[0].usedPercent, 0);
  await useClaudeReset(dir, { ...input, retry: true, grantId: intent.grantId }, request, (value) => {
    intent = value;
  });
  await assert.rejects(useClaudeReset(dir, input, request), /no available credit/);
});
