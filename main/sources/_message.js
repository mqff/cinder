const { num } = require("../io");
function parseMessage(message, context) {
  if (message?.role !== "assistant" || !message.tokens) return null;
  const { tokens, time = {} } = message;
  return {
    source: context.source,
    ts: time.created ?? time.completed,
    model: message.modelID || message.model,
    provider: message.providerID || context.source,
    project: context.project,
    session: message.sessionID || context.session,
    input: num(tokens.input),
    output: num(tokens.output),
    reasoning: num(tokens.reasoning),
    cacheWrite: num(tokens.cache?.write),
    cacheRead: num(tokens.cache?.read),
    cost: message.cost,
    dedup: message.id
  };
}
module.exports = { parseMessage };
