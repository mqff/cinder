const { contextBridge, ipcRenderer } = require("electron");
const invoke = (channel) => () => ipcRenderer.invoke(channel);
const subscribe = (channel) => (callback) => {
  if (typeof callback !== "function") throw new TypeError("Listener must be a function");
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld(
  "cinder",
  Object.freeze({
    platform: process.platform,
    minimize: invoke("window:minimize"),
    close: invoke("window:close"),
    toggleMaximize: invoke("window:toggle-maximize"),
    isMaximized: invoke("window:is-maximized"),
    collect: invoke("usage:collect"),
    readPricing: invoke("pricing:read"),
    savePricing: (rules) => ipcRenderer.invoke("pricing:save", rules),
    calls: invoke("usage:calls"),
    readLimits: invoke("limits:read"),
    onLimitsProgress: subscribe("limits:progress"),
    refreshLimits: invoke("limits:refresh"),
    cursorAccountUsage: (input) => ipcRenderer.invoke("accounts:cursor-usage", input),
    useResetCredit: (input) => ipcRenderer.invoke("limits:reset", input),
    limitsProfiles: invoke("limits:profiles"),
    addLimitsProfile: (provider) => ipcRenderer.invoke("limits:add-profile", provider),
    removeLimitsProfile: (profile) => ipcRenderer.invoke("limits:remove-profile", profile),
    cancelScan: invoke("usage:cancel"),
    snapshotInfo: invoke("snapshot:info"),
    snapshotUsage: invoke("snapshot:usage"),
    snapshotCalls: invoke("snapshot:calls"),
    setBackground: (color) => {
      if (typeof color === "string") ipcRenderer.send("theme:background", color);
    },
    onWindowState: subscribe("window:state"),
    onScanProgress: subscribe("usage:progress"),
    onMenuRescan: subscribe("menu:rescan")
  })
);
