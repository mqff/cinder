const { collect } = require("./collect");
const { collectCalls } = require("./calls");
const { collectLimits, consumeReset, cursorUsage } = require("./limits");

function post(msg) {
  process.parentPort.postMessage(msg);
}

let tail = Promise.resolve();

process.parentPort.on("message", (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;
  const { id, kind, cacheDir, input } = msg;
  tail = tail.then(async () => {
    try {
      if (!["calls", "collect", "limits", "limit-reset", "cursor-usage"].includes(kind))
        throw new Error("Unknown scan kind");
      const result =
        kind === "cursor-usage"
          ? await cursorUsage(cacheDir, input)
          : kind === "limits"
            ? await collectLimits(cacheDir, undefined, (progress) => post({ type: "progress", id, progress }))
            : kind === "limit-reset"
              ? await consumeReset(cacheDir, input)
              : kind === "calls"
                ? await collectCalls(cacheDir)
                : await collect(cacheDir, (progress) => post({ type: "progress", id, progress }));
      post({ type: "done", id, result });
    } catch (error) {
      post({ type: "error", id, message: String(error?.message || error) });
    }
  });
});
