function limitsFixture() {
  const at = Date.now(),
    future = (hours) => new Date(at + hours * 3600000).toISOString();
  const row = (id, label, kind, usedPercent, hours, scope) => ({
    id,
    label,
    kind,
    usedPercent,
    resetsAt: future(hours),
    scope,
    durationMinutes: kind === "session" ? 300 : kind === "weekly" ? 10080 : undefined
  });
  const account = (id, provider, label, plan, windows, extra = {}) => ({
    id: id.repeat(24),
    provider,
    label,
    plan,
    windows,
    status: "ready",
    checkedAt: new Date(at).toISOString(),
    ...extra
  });
  return {
    checkedAt: new Date(at).toISOString(),
    accounts: [
      account(
        "a",
        "codex",
        "work@example.test",
        "pro",
        [row("session", "5-hour", "session", 34, 2), row("weekly", "Weekly", "weekly", 100, 23)],
        { ordinaryUsageAllowed: false, resetCredits: { available: 2, canUse: true, nextExpiresAt: future(200) } }
      ),
      account("b", "codex", "personal@example.test", "Plus", [
        row("session", "5-hour", "session", 18, 3),
        row("weekly", "Weekly", "weekly", 24, 110)
      ]),
      account(
        "c",
        "claude",
        "Claude subscription",
        "Max",
        [
          row("session", "5-hour", "session", 22, 4),
          row("weekly", "Weekly", "weekly", 56, 87),
          row("sonnet", "Weekly Sonnet", "weekly", 28, 87, "sonnet")
        ],
        {
          resetCredits: {
            available: 3,
            canUse: true,
            options: [
              { kind: "weekly", label: "Weekly reset", description: "Refills the weekly allowance.", available: 1 },
              {
                kind: "fable",
                label: "Fable reset",
                description: "Refills Fable and returns its weekly usage. Other weekly usage remains.",
                available: 2
              }
            ]
          }
        }
      ),
      account("d", "cursor", "dev@example.test", "pro_plus", [
        row("total", "Monthly allowance", "monthly", 38, 200),
        row("auto", "Auto", "monthly", 12, 200, "auto"),
        row("api", "API", "monthly", 64, 200, "api")
      ]),
      account("e", "grok", "Grok account", "SuperGrok", [row("weekly", "Weekly", "weekly", 8, 52)]),
      account("f", "opencode", "OpenCode Go", "Go", [
        row("session", "Go 5-hour", "session", 3, 1),
        row("weekly", "Go Weekly", "weekly", 12, 75),
        row("monthly", "Go Monthly", "monthly", 22, 400)
      ]),
      account("4", "opencode", "OpenRouter", "api_key", [
        {
          id: "paid-credits",
          label: "Paid credits",
          kind: "other",
          scope: "paid-credits",
          usedPercent: 100,
          unit: "USD",
          usedAmount: 0,
          totalAmount: 0
        }
      ]),
      account("1", "antigravity", "google@example.test", "Google AI Pro", [
        row("gemini", "Gemini 5-hour", "session", 44, 2, "gemini"),
        row("gemini-week", "Gemini Weekly", "weekly", 20, 60, "gemini")
      ]),
      {
        ...account("2", "copilot", "GitHub Copilot", undefined, []),
        status: "unavailable",
        message: "This tool does not expose an account allowance through its local history."
      },
      {
        ...account("3", "antigravity", "expired@example.test", undefined, []),
        status: "error",
        message: "Authorization expired. Sign in again in the provider's app."
      }
    ]
  };
}
function cursorUsageFixture(days) {
  const { Collector } = require("../main/normalize");
  const collector = new Collector();
  const until = Date.now();
  const models = [
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "gpt-5",
    "gpt-5-mini",
    "gemini-3-flash",
    "grok-4",
    "claude-haiku-4-5",
    "auto"
  ];
  for (let index = 0; index < models.length; index++)
    collector.add({
      ts: until - index * 3600000,
      source: "cursor",
      project: "Account usage",
      session: `billing-${index}`,
      model: models[index],
      input: (index + 1) * 3200,
      output: (index + 1) * 840,
      cacheRead: (index + 1) * 7000,
      cost: (index + 1) * 0.18
    });
  return {
    ...collector.result(),
    from: new Date(until - days * 86400000).toISOString(),
    until: new Date(until).toISOString(),
    omitted: 2
  };
}
module.exports = { limitsFixture, cursorUsageFixture };
