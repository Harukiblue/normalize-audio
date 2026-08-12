import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from "electron";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "@derhuerst/ffprobe-static";
import type { JobEvent } from "../src/types";
import { AudioProcessor, ProcessingError } from "./processor";

const IPC = {
  select: "audio:select",
  registerDrop: "audio:register-drop",
  start: "audio:start",
  cancel: "audio:cancel",
  open: "audio:open",
  reveal: "audio:reveal",
  event: "audio:event",
} as const;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "sermon-audio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let processor: AudioProcessor | null = null;
let isQuitting = false;
const approvedSources = new Set<string>();

function unpackedBinary(binaryPath: string | null): string {
  if (!binaryPath) {
    throw new ProcessingError(
      "PROCESSOR_MISSING",
      "The bundled audio processor is unavailable. Reinstall the application.",
    );
  }
  return app.isPackaged ? binaryPath.replace("app.asar", "app.asar.unpacked") : binaryPath;
}

function broadcast(event: JobEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.event, event);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 720,
    minHeight: 620,
    backgroundColor: "#f3f0e8",
    show: false,
    title: "Sermon Audio Cleaner",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const allowed = process.env.VITE_DEV_SERVER_URL;
    if (allowed && targetUrl.startsWith(allowed)) return;
    if (targetUrl.startsWith("file:")) return;
    event.preventDefault();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function configureNetworkBoundary(): void {
  if (process.env.VITE_DEV_SERVER_URL) return;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const scheme = new URL(details.url).protocol;
      const allowed = new Set(["file:", "sermon-audio:", "data:", "blob:", "devtools:"]);
      callback({ cancel: !allowed.has(scheme) });
    } catch {
      callback({ cancel: true });
    }
  });
}

function configureProtocol(): void {
  protocol.handle("sermon-audio", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "result" || !processor) {
      return new Response("Not found", { status: 404 });
    }
    const jobId = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const result = processor.resultFor(jobId);
    if (!result) return new Response("Not found", { status: 404 });

    return net.fetch(pathToFileURL(result.outputPath).toString(), {
      headers: request.headers,
    });
  });
}

function configureIpc(): void {
  ipcMain.handle(IPC.select, async () => {
    if (!mainWindow || !processor) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a sermon recording",
      properties: ["openFile"],
      filters: [
        {
          name: "Audio recordings",
          extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "webm"],
        },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const selection = await processor.selectionFor(result.filePaths[0]);
    approvedSources.add(selection.sourcePath);
    return selection;
  });

  ipcMain.handle(IPC.registerDrop, async (_event, sourcePath: unknown) => {
    if (!processor || typeof sourcePath !== "string") {
      throw new ProcessingError("FILE_NOT_FOUND", "That dropped file could not be read.");
    }
    const selection = await processor.selectionFor(sourcePath);
    approvedSources.add(selection.sourcePath);
    return selection;
  });

  ipcMain.handle(IPC.start, (_event, sourcePath: unknown) => {
    if (!processor || typeof sourcePath !== "string" || !approvedSources.has(sourcePath)) {
      throw new ProcessingError("FILE_NOT_FOUND", "Select or drop the recording again.");
    }
    return processor.start(sourcePath);
  });

  ipcMain.handle(IPC.cancel, async (_event, jobId: unknown) => {
    if (processor && typeof jobId === "string") await processor.cancel(jobId);
  });

  ipcMain.handle(IPC.open, async (_event, jobId: unknown) => {
    if (!processor || typeof jobId !== "string") return;
    const result = processor.resultFor(jobId);
    if (!result) return;
    const error = await shell.openPath(result.outputPath);
    if (error) throw new Error(error);
  });

  ipcMain.handle(IPC.reveal, (_event, jobId: unknown) => {
    if (!processor || typeof jobId !== "string") return;
    const result = processor.resultFor(jobId);
    if (result) shell.showItemInFolder(result.outputPath);
  });
}

app.whenReady().then(() => {
  processor = new AudioProcessor({
    ffmpegPath: unpackedBinary(ffmpegStatic),
    ffprobePath: unpackedBinary(ffprobeStatic),
    downloadsDirectory: app.getPath("downloads"),
    emit: broadcast,
  });
  configureNetworkBoundary();
  configureProtocol();
  configureIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (isQuitting || !processor) return;
  event.preventDefault();
  isQuitting = true;
  void processor.dispose().finally(() => app.quit());
});
