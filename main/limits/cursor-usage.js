const { requestJson, bearer, QuotaError } = require("./common");
const { cursorLogin } = require("./cursor-auth");
const { Collector } = require("../normalize");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
      .join(",")}}`;
  return JSON.stringify(value);
}
function overlap(previous, next) {
  const sequence = [...next, Symbol("boundary"), ...previous],
    lengths = [];
  for (let index = 0; index < sequence.length; index++) {
    let matched = index ? lengths[index - 1] : 0;
    while (matched && sequence[index] !== sequence[matched]) matched = lengths[matched - 1];
    if (index && sequence[index] === sequence[matched]) matched++;
    lengths.push(matched);
  }
  return lengths.at(-1) || 0;
}
function normalizeEvent(event, from, until) {
  if (!event || typeof event !== "object") throw new QuotaError("Cursor returned an invalid billing event.");
  const usage = event.tokenUsage;
  if (usage === undefined || usage === null) return null;
  if (typeof usage !== "object" || Array.isArray(usage)) throw new QuotaError("Cursor returned invalid token usage.");
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalCents"])
    if (usage[key] !== undefined && (!Number.isFinite(usage[key]) || usage[key] < 0))
      throw new QuotaError("Cursor returned invalid token totals.");
  const time =
    typeof event.timestamp === "string" && /^\d+$/.test(event.timestamp) ? Number(event.timestamp) : event.timestamp;
  if (!Number.isFinite(time) || typeof event.model !== "string" || !event.model)
    throw new QuotaError("Cursor returned invalid billing metadata.");
  if (time < from || time > until) return null;
  return {
    ts: time,
    source: "cursor",
    provider: "cursor",
    model: event.model,
    session: (typeof event.conversationId === "string" && event.conversationId) || "Account usage",
    project: "Account usage",
    input: usage.inputTokens || 0,
    output: usage.outputTokens || 0,
    cacheRead: usage.cacheReadTokens || 0,
    cacheWrite: usage.cacheWriteTokens || 0,
    cost: usage.totalCents === undefined ? undefined : usage.totalCents / 100,
    allowEmpty: true
  };
}
async function readCursorAccount(root, input, options = {}) {
  const request = options.request || requestJson;
  const login = await (options.login || cursorLogin)(root, request);
  if (!login || login.id !== input.accountId)
    throw new QuotaError("The Cursor account changed. Refresh Limits before loading account usage.");
  if (![7, 30, 90].includes(input.days)) throw new QuotaError("Choose 7, 30 or 90 days.");
  const started = Date.now(),
    until = options.now || started,
    from = until - input.days * 86400000;
  const pages = [],
    all = [];
  let previous = [],
    total;
  for (let page = 1; ; page++) {
    if (
      Date.now() - started > 60000 ||
      page > (total === undefined ? 1000 : Math.min(1000, Math.ceil(total / 1000) * 2 + 1))
    )
      throw new QuotaError("Cursor account usage exceeded its scan limit. Choose a shorter period.");
    const data = await request("https://api2.cursor.sh/aiserver.v1.DashboardService/GetFilteredUsageEvents", {
      method: "POST",
      headers: { ...bearer(login.token), "connect-protocol-version": "1" },
      body: JSON.stringify({ page, pageSize: 1000, startDate: String(from), endDate: String(until) })
    });
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      ["error", "message", "code"].some((key) => Object.hasOwn(data, key))
    )
      throw new QuotaError("Cursor could not report account usage.");
    const count = data.totalUsageEventsCount;
    const events =
      data.usageEventsDisplay ?? (Object.keys(data).every((key) => key === "totalUsageEventsCount") ? [] : null);
    if (
      !Array.isArray(events) ||
      events.length > 1000 ||
      (count !== undefined && (!Number.isSafeInteger(count) || count < 0 || (total !== undefined && total !== count)))
    )
      throw new QuotaError("Cursor returned inconsistent billing pages. Refresh to try again.");
    if (count !== undefined) total = count;
    const signatures = events.map(canonical);
    pages.push({ start: all.length, length: events.length, overlap: overlap(previous, signatures) });
    for (const event of events) all.push(normalizeEvent(event, from, until));
    previous = signatures;
    if (events.length < 1000) break;
  }
  if (total !== undefined && all.length < total) throw new QuotaError("Cursor returned incomplete account usage.");
  let excess = total === undefined ? 0 : all.length - total,
    omitted = 0;
  const collector = new Collector(options.pricing);
  for (const page of pages) {
    const remove = Math.min(excess, page.overlap);
    excess -= remove;
    for (let index = remove; index < page.length; index++) {
      const entry = all[page.start + index];
      if (entry) collector.add(entry);
      else omitted++;
    }
  }
  if (excess !== 0) throw new QuotaError("Cursor billing page boundaries were inconsistent. Refresh to try again.");
  return { ...collector.result(), from: new Date(from).toISOString(), until: new Date(until).toISOString(), omitted };
}
module.exports = { readCursorAccount };
