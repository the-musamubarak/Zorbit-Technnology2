import { app, BrowserWindow, session } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { registerIpcHandlers } from "./ipc/handlers";
import { closeDb } from "./db/connection";

// Explicit, not inferred from package.json's "name" — this is what actually
// controls the window title, taskbar/dock label, and (on Windows) the
// AppData folder the SQLite database lives in. Setting it directly here
// means it can't drift out of sync with package.json's npm-package name
// (which follows npm's lowercase-hyphenated convention, not the display name).
app.setName("Zorbit Ledger");

// Single instance lock: prevents someone accidentally opening the app twice
// on the same laptop, which would mean two processes writing to the same
// SQLite file at once. Second launch just focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let productionServer: ChildProcess | null = null;

const PRODUCTION_SERVER_PORT = 4173;
const PRODUCTION_STARTUP_TIMEOUT_MS = 10000;

function waitForProductionServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = (): void => {
      const socket = net.createConnection({ host: "127.0.0.1", port: PRODUCTION_SERVER_PORT });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > PRODUCTION_STARTUP_TIMEOUT_MS) {
          reject(new Error("The packaged renderer server did not start within 10 seconds."));
        } else {
          setTimeout(check, 100);
        }
      });
    };
    check();
  });
}

async function startProductionServer(): Promise<void> {
  const serverRoot = app.isPackaged
    ? path.join(process.resourcesPath, ".output")
    : path.join(app.getAppPath(), ".output");
  const serverPath = path.join(serverRoot, "server/index.mjs");
  const nodePath = app.isPackaged ? path.join(process.resourcesPath, "node.exe") : process.execPath;
  productionServer = spawn(nodePath, [serverPath], {
    cwd: serverRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOST: "127.0.0.1",
      PORT: String(PRODUCTION_SERVER_PORT),
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: String(PRODUCTION_SERVER_PORT),
    },
    stdio: "inherit",
  });
  productionServer.once("error", (error) => {
    console.error("Failed to start the packaged renderer server:", error);
  });
  await waitForProductionServer();
}

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 340,
    height: 340,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    backgroundColor: "#0B0B0D",
    show: false,
    webPreferences: { sandbox: true },
  });
  splashWindow.loadFile(path.join(__dirname, "../splash/splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow?.show());
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#FFFFFF", // matches the app's white background, avoids a flash on load
    show: false, // stays hidden until the splash hand-off below — see showMainWindow()
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), // compiled output, see electron/tsconfig notes
      contextIsolation: true, // renderer cannot reach Node/Electron internals directly
      nodeIntegration: false, // no `require` inside the page — closes the most common Electron RCE path
      sandbox: true, // OS-level sandboxing for the renderer process
      spellcheck: false,
    },
  });

  // Splash-to-main hand-off: the splash window covers app startup (DB init,
  // IPC registration, initial page load), and closes once the main window
  // actually has something to show. Three ways this can fire — whichever
  // comes first wins, so a slow OR a failed prod load (see loading-strategy
  // note below — Stage 4 isn't finalized yet, so the placeholder page can
  // legitimately error right now) still ends with the user looking at
  // *something* rather than being stuck on the splash screen forever.
  let handedOff = false;
  const MIN_SPLASH_MS = 900; // long enough to register as an intentional brand moment, not a flicker
  const splashShownAt = Date.now();

  function showMainWindow(): void {
    if (handedOff || !mainWindow) return;
    handedOff = true;
    const elapsed = Date.now() - splashShownAt;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
    setTimeout(() => {
      mainWindow?.show();
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
    }, remaining);
  }

  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.webContents.once("did-fail-load", showMainWindow);
  // Absolute safety net: never leave the user staring at the splash forever,
  // even if none of the above events fire for some unforeseen reason.
  setTimeout(showMainWindow, 6000);

  const devServerUrl = process.env.ELECTRON_DEV_SERVER_URL;
  const openDevTools = process.env.ELECTRON_OPEN_DEVTOOLS === "true";
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    if (openDevTools) mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${PRODUCTION_SERVER_PORT}`);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // Lock down what the renderer's <img>/fetch/etc. is allowed to load.
  // No remote content should ever be needed in a fully offline app — if
  // something tries to reach the network, that's worth knowing about, not
  // silently allowing.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const isLocal =
      url.startsWith("file://") ||
      url.startsWith("devtools://") ||
      url.startsWith("http://localhost") ||
      url.startsWith("ws://localhost") || // Vite HMR websocket in dev mode
      url.startsWith("data:");
    callback({ cancel: !isLocal });
  });

  createSplashWindow();
  registerIpcHandlers();
  if (!process.env.ELECTRON_DEV_SERVER_URL) {
    try {
      await startProductionServer();
    } catch (error) {
      console.error("Production server startup timed out:", error);
    }
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  closeDb();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  productionServer?.kill();
  closeDb();
});
