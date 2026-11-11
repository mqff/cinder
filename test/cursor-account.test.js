const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readCursorAccount } = require("../main/limits/cursor-usage");
const at = Date.now(),
  input = { accountId: "fixture", days: 30 };
const event = (index = 0) => ({
  timestamp: String(at - 100000 - index),
  model: "fixture",
  conversationId: "session",
  tokenUsage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, totalCents: 2 }
});
const options = (request) => ({ request, now: at, login: async () => ({ id: "fixture", token: "test-secret" }) });
test("Cursor billing pages remove only count-proven overlaps and preserve identical billed events", async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => event(index)),
    last = rows.at(-1);
  const result = await readCursorAccount(
    "fixture",
    input,
    options(async (url, request) => {
      assert.ok(url.endsWith("/GetFilteredUsageEvents"));
      assert.equal(request.headers.Authorization, "Bearer test-secret");
      const params = JSON.parse(request.body);
      assert.equal(params.pageSize, 1000);
      assert.equal(typeof params.startDate, "string");
      return {
        totalUsageEventsCount: 1002,
        usageEventsDisplay: params.page === 1 ? rows : [last, event(1000), event(1000)]
      };
    })
  );
  assert.equal(
    result.entries.reduce((sum, entry) => sum + entry.n, 0),
    1002
  );
  assert.ok(Math.abs(result.entries.reduce((sum, entry) => sum + entry.cost, 0) - 20.04) < 1e-8);
  assert.equal(result.entries[0].costOrigin, "reported");
  assert.ok(!JSON.stringify(result).includes("test-secret"));
});
test("Cursor billing omissions and a reported zero remain distinct from missing costs", async () => {
  const result = await readCursorAccount(
    "fixture",
    input,
    options(async () => ({
      totalUsageEventsCount: 3,
      usageEventsDisplay: [
        { type: "non-token" },
        event(),
        { ...event(1), tokenUsage: { inputTokens: 5, totalCents: 0 } }
      ]
    }))
  );
  assert.equal(result.omitted, 1);
  assert.equal(
    result.entries.reduce((sum, entry) => sum + entry.n, 0),
    2
  );
  assert.equal(
    result.entries.reduce((sum, entry) => sum + entry.cost, 0),
    0.02
  );
});
test("Cursor account usage rejects changed identities, incomplete pages and invalid token totals", async () => {
  await assert.rejects(
    readCursorAccount(
      "fixture",
      { ...input, accountId: "changed" },
      options(() => assert.fail("No request for another account"))
    ),
    /account changed/
  );
  await assert.rejects(
    readCursorAccount(
      "fixture",
      input,
      options(async () => ({ totalUsageEventsCount: 5, usageEventsDisplay: [event()] }))
    ),
    /incomplete/
  );
  await assert.rejects(
    readCursorAccount(
      "fixture",
      input,
      options(async () => ({ usageEventsDisplay: [{ ...event(), tokenUsage: { inputTokens: -1 } }] }))
    ),
    /invalid token totals/
  );
});
