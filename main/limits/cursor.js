const { queryLive } = require("../sqlite");
const { account, window, requestJson, bearer, iso } = require("./common");
const { cursorLogin } = require("./cursor-auth");

function cursorWindows(data) {
  const reset = iso(data?.billingCycleEnd);
  return [
    ["totalPercentUsed", "Monthly allowance"],
    ["autoPercentUsed", "Auto"],
    ["apiPercentUsed", "API"]
  ]
    .map(([id, label]) =>
      window(id, label, data?.planUsage?.[id], {
        kind: "monthly",
        resetsAt: reset,
        scope: id === "totalPercentUsed" ? undefined : id
      })
    )
    .filter(Boolean);
}
async function readCursor(root, request = requestJson, query = queryLive) {
  let result = account("cursor", root);
  try {
    const login = await cursorLogin(root, request, query);
    if (!login) return { ...result, message: "Sign in to Cursor to read its monthly allowance." };
    const { token, id, label, plan } = login;
    result = { ...result, id, label, plan };
    const response = await request("https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage", {
      method: "POST",
      headers: { ...bearer(token), "connect-protocol-version": "1", "x-cursor-client-type": "cli" },
      body: "{}"
    });
    const windows = cursorWindows(response);
    return {
      ...result,
      status: windows.length ? "ready" : "unavailable",
      windows,
      message: windows.length ? undefined : "Cursor did not return a monthly allowance."
    };
  } catch (error) {
    return { ...result, status: error.code === "unsupported" ? "unavailable" : "error", message: error.message };
  }
}

module.exports = { cursorWindows, readCursor };
