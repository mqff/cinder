const { app, BrowserWindow, Menu, ipcMain, screen, shell, utilityProcess, dialog } = require("electron");
const path = require("node:path");
const { json } = require("./main/io");
const { writeJsonFile } = require("./main/jsonfile");
const { normalizeWindowState } = require("./main/window-state");
const { createWorkerPool } = require("./main/worker-pool");
const { createScanService } = require("./main/scan-service");
const { createLimitsService } = require("./main/limits-service");
const { savedProfiles, addProfile, removeProfile } = require("./main/limits");
const { readRules } = require("./main/pricing-rules");
let window = null,
  saveTimer,
  service,
  limitsService;
let state = normalizeWindowState();
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");
const current = () => (window && !window.isDestroyed() ? window : null);
function saveWindow() {
  const target = current();
  if (!target) return;
  state = normalizeWindowState({ ...state, ...target.getNormalBounds(), maximized: target.isMaximized() });
  try {
    writeJsonFile(stateFile(), state);
  } catch (error) {
    console.error("Window state:", error.message);
  }
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWindow, 300);
}
function openLink(value) {
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol))
      void shell.openExternal(url.href).catch((error) => console.error("Open link:", error.message));
  } catch {}
}
function pool(name, channel = "usage:progress") {
  return createWorkerPool(
    () =>
      utilityProcess.fork(path.join(__dirname, "main", "scan-worker.js"), [], {
        serviceName: name,
        execArgv: ["--max-old-space-size=4096"]
      }),
    (progress) => current()?.webContents.send(channel, progress)
  );
}
const usagePool = pool("cinder-usage"),
  callsPool = pool("cinder-calls"),
  limitsPool = pool("cinder-limits", "limits:progress"),
  accountsPool = pool("cinder-accounts");
function limits() {
  return (limitsService ||= createLimitsService({ dir: app.getPath("userData"), pool: limitsPool }));
}
function scans() {
  return (service ||= createScanService({ dir: app.getPath("userData"), usagePool, callsPool }));
}
function trusted(event) {
  const target = current();
  if (!target || event.sender !== target.webContents || event.senderFrame !== target.webContents.mainFrame)
    throw new Error("Untrusted IPC sender");
}
const handlers = {
  "window:minimize": () => current()?.minimize(),
  "window:close": () => current()?.close(),
  "window:is-maximized": () => current()?.isMaximized() || false,
  "window:toggle-maximize": () => {
    const target = current();
    if (!target) return false;
    if (target.isMaximized()) target.unmaximize();
    else target.maximize();
    return target.isMaximized();
  },
  "usage:collect": () => scans().collect(),
  "pricing:read": () => readRules(app.getPath("userData")),
  "pricing:save": (rules) => scans().updatePricing(rules),
  "usage:calls": () => scans().calls(),
  "usage:cancel": () => scans().cancel(),
  "limits:read": () => limits().read(),
  "limits:refresh": () => limits().refresh(),
  "limits:reset": (input) => limits().consume(input),
  "accounts:cursor-usage": (input) =>
    accountsPool.run(
      { kind: "cursor-usage", cacheDir: app.getPath("userData"), input },
      { entries: [], sources: [], scannedAt: "", from: "", until: "" }
    ),
  "limits:profiles": () => savedProfiles(app.getPath("userData")),
  "limits:remove-profile": (profile) => removeProfile(app.getPath("userData"), profile),
  "limits:add-profile": async (provider) => {
    if (!["codex", "claude", "cursor", "grok", "opencode", "antigravity"].includes(provider))
      throw new Error("Unknown provider.");
    const result = await dialog.showOpenDialog(current(), {
      title: "Select an existing account directory",
      properties: ["openDirectory"]
    });
    return result.canceled
      ? savedProfiles(app.getPath("userData"))
      : addProfile(app.getPath("userData"), { provider, root: result.filePaths[0] });
  },
  "snapshot:info": () => scans().info(),
  "snapshot:usage": () => scans().usage(),
  "snapshot:calls": () => scans().savedCalls()
};
for (const [channel, handler] of Object.entries(handlers))
  ipcMain.handle(channel, (event, input) => {
    trusted(event);
    return handler(input);
  });
ipcMain.on("theme:background", (event, value) => {
  try {
    trusted(event);
  } catch {
    return;
  }
  const next = normalizeWindowState({ ...state, bg: value });
  state.bg = next.bg;
  current()?.setBackgroundColor(state.bg);
  scheduleSave();
});
function createWindow() {
  const visible =
    Number.isFinite(state.x) &&
    screen
      .getAllDisplays()
      .some(
        ({ workArea: area }) =>
          state.x + 80 > area.x &&
          state.x < area.x + area.width &&
          state.y + 40 > area.y &&
          state.y < area.y + area.height
      );
  const target = new BrowserWindow({
    width: state.width,
    height: state.height,
    minWidth: 940,
    minHeight: 600,
    ...(visible ? { x: state.x, y: state.y } : {}),
    show: false,
    title: "Cinder",
    backgroundColor: state.bg,
    icon: path.join(__dirname, "icon", process.platform === "win32" ? "icon.ico" : "icon.png"),
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 13 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false
    }
  });
  window = target;
  if (state.maximized) target.maximize();
  target.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: "deny" };
  });
  target.webContents.on("will-navigate", (event, url) => {
    if (url !== target.webContents.getURL()) event.preventDefault();
  });
  target.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  target.webContents.session.setPermissionCheckHandler(() => false);
  let recovered = false;
  target.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer stopped:", details.reason);
    if (details.reason !== "clean-exit" && !target.isDestroyed() && !recovered) {
      recovered = true;
      target.reload();
    }
  });
  for (const event of ["maximize", "unmaximize"])
    target.on(event, () => {
      target.webContents.send("window:state", target.isMaximized());
      scheduleSave();
    });
  for (const event of ["move", "resize"]) target.on(event, scheduleSave);
  target.on("close", saveWindow);
  target.on("closed", () => {
    clearTimeout(saveTimer);
    window = null;
  });
  target.once("ready-to-show", () => target.show());
  if (process.env.CINDER_DEV === "1") {
    void target.loadURL("http://127.0.0.1:5173");
    target.webContents.openDevTools({ mode: "detach" });
  } else void target.loadFile(path.join(__dirname, "dist", "index.html"));
}
function installMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" }
        ]
      },
      {
        label: "View",
        submenu: [
          { label: "Rescan", accelerator: "CmdOrCtrl+R", click: () => current()?.webContents.send("menu:rescan") },
          { role: "togglefullscreen" }
        ]
      },
      { role: "windowMenu" }
    ])
  );
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const target = current();
    if (!target) return;
    if (target.isMinimized()) target.restore();
    target.focus();
  });
  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("app.local.cinder");
    state = normalizeWindowState(json(stateFile(), {}));
    installMenu();
    createWindow();
    app.on("activate", () => {
      if (!current()) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", () => {
    clearTimeout(saveTimer);
    usagePool.stop();
    callsPool.stop();
    limitsPool.stop();
    accountsPool.stop();
  });
}
