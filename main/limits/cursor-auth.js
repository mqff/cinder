const path = require("node:path");
const { queryLive } = require("../sqlite");
const { requestJson, bearer, fingerprint, QuotaError } = require("./common");

async function cursorLogin(root, request = requestJson, query = queryLive) {
  if (
    process.env.CURSOR_API_ENDPOINT &&
    process.env.CURSOR_API_ENDPOINT.replace(/\/$/, "") !== "https://api2.cursor.sh"
  )
    throw new QuotaError("This Cursor connection uses a custom endpoint.", "unsupported");
  const rows = await query(
    path.join(root, "globalStorage", "state.vscdb"),
    "SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/accessToken', 'cursorAuth/cachedEmail', 'cursorAuth/stripeMembershipType')"
  );
  const values = Object.fromEntries((rows || []).map((row) => [row.key, row.value]));
  let token = process.env.CURSOR_AUTH_TOKEN;
  if (!token && process.env.CURSOR_API_KEY)
    token = (
      await request("https://api2.cursor.sh/auth/exchange_user_api_key", {
        method: "POST",
        headers: bearer(process.env.CURSOR_API_KEY),
        body: "{}"
      })
    ).accessToken;
  token ||= values["cursorAuth/accessToken"];
  if (typeof token !== "string" || !token) return null;
  const configured = process.env.CURSOR_AUTH_TOKEN || process.env.CURSOR_API_KEY;
  return {
    token,
    id: fingerprint("cursor", configured || values["cursorAuth/cachedEmail"] || token),
    label: configured ? "Configured Cursor account" : values["cursorAuth/cachedEmail"] || "Cursor account",
    plan: configured ? undefined : values["cursorAuth/stripeMembershipType"]
  };
}
module.exports = { cursorLogin };
