function createWorkerPool(spawn, onProgress = () => {}) {
  let proc = null;
  let nextId = 1;
  const jobs = new Map();
  function settleAll(result) {
    for (const job of jobs.values()) job.resolve({ ...job.fallback, ...result });
    jobs.clear();
  }
  function ensure() {
    if (proc) return proc;
    const child = spawn();
    proc = child;
    child.on("message", (msg) => {
      if (proc !== child || !msg || !jobs.has(msg.id)) return;
      if (!["progress", "done", "error"].includes(msg.type)) return;
      if (msg.type === "progress") return onProgress(msg.progress);
      const job = jobs.get(msg.id);
      jobs.delete(msg.id);
      job.resolve(msg.type === "done" ? msg.result : { ...job.fallback, error: msg.message || "Worker failed" });
    });
    const failed = (error) => {
      if (proc !== child) return;
      proc = null;
      settleAll({ error });
    };
    child.on("exit", (code) => failed(`Scan worker exited (code ${code})`));
    child.on("error", (error) => {
      failed(String(error));
      try {
        child.kill();
      } catch {}
    });
    return child;
  }
  return {
    run(payload, fallback) {
      return new Promise((resolve) => {
        const id = nextId++;
        jobs.set(id, { resolve, fallback });
        try {
          ensure().postMessage({ id, ...payload });
        } catch (error) {
          const child = proc;
          proc = null;
          settleAll({ error: String(error) });
          try {
            child?.kill();
          } catch {}
        }
      });
    },
    stop() {
      const child = proc;
      proc = null;
      settleAll({ cancelled: true });
      try {
        child?.kill();
      } catch {}
      return Boolean(child);
    }
  };
}
module.exports = { createWorkerPool };
