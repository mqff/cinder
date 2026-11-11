const fs = require("node:fs");
const path = require("node:path");

module.exports = function addSmokeHistory(root, large = false) {
  const records = [];
  for (let day = 1; day <= 35; day++) {
    const date = new Date();
    date.setDate(date.getDate() - day);
    date.setHours(14, 0, 0, 0);
    const weight = date.getDay() === 0 || date.getDay() === 6 ? 0.3 : 1;
    for (let request = 0; request < 8 + (day % 11); request++) {
      const timestamp = new Date(date.getTime() + request * 60000).toISOString();
      records.push({
        timestamp,
        cwd: "/work/cinder",
        sessionId: `session-${day}`,
        message: {
          id: `message-${day}-${request}`,
          model: day % 3 ? "claude-sonnet-4-20250514" : "claude-opus-4-20250514",
          usage: {
            input_tokens: Math.round((12000 + (day % 5) * 3500) * weight),
            output_tokens: Math.round((2200 + request * 130) * weight),
            cache_read_input_tokens: Math.round((22000 + day * 430) * weight)
          },
          ...(day === 1 && request === 0
            ? {
                content: Array.from({ length: 12 }, (_, index) => ({
                  type: "tool_use",
                  id: `smoke-tool-${index}`,
                  name: `fixture_tool_${String(index).padStart(2, "0")}`,
                  input: {}
                }))
              }
            : {})
        }
      });
    }
  }
  const earlier = new Date();
  earlier.setDate(earlier.getDate() - 1);
  earlier.setHours(13, 0, 0, 0);
  records.push({
    timestamp: earlier.toISOString(),
    cwd: "/work/cinder",
    sessionId: "session-1",
    message: { id: "previous-model", model: "gpt-5", usage: { input_tokens: 1, output_tokens: 1 } }
  });
  for (let hour = 0; hour <= new Date().getHours(); hour += 3) {
    const date = new Date();
    date.setHours(hour, 0, 0, 0);
    records.push({
      timestamp: date.toISOString(),
      cwd: "/work/cinder",
      sessionId: "today",
      message: {
        id: `today-${hour}`,
        model: "claude-sonnet-4-20250514",
        usage: {
          input_tokens: 9000 + hour * 2000,
          output_tokens: 1200 + hour * 150,
          cache_read_input_tokens: 40000 + hour * 1000
        }
      }
    });
  }
  if (large)
    for (let index = 0; index < 10000; index++)
      records.push({
        timestamp: new Date().toISOString(),
        cwd: `/work/stress-project-${String(index).padStart(5, "0")}`,
        sessionId: "stress-session",
        message: {
          id: `stress-${index}`,
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 1, output_tokens: 1 }
        }
      });
  fs.writeFileSync(
    path.join(root, "claude", "projects", "app", "history.jsonl"),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n"
  );
};
