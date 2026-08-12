import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { JobEvent, SermonCleanerApi } from "../src/types";

const IPC = {
  select: "audio:select",
  registerDrop: "audio:register-drop",
  start: "audio:start",
  cancel: "audio:cancel",
  open: "audio:open",
  reveal: "audio:reveal",
  event: "audio:event",
} as const;

const api: SermonCleanerApi = {
  selectAudio: () => ipcRenderer.invoke(IPC.select),
  registerDroppedFile: (file) =>
    ipcRenderer.invoke(IPC.registerDrop, webUtils.getPathForFile(file)),
  startProcessing: (sourcePath) => ipcRenderer.invoke(IPC.start, sourcePath),
  cancelProcessing: (jobId) => ipcRenderer.invoke(IPC.cancel, jobId),
  openOutput: (jobId) => ipcRenderer.invoke(IPC.open, jobId),
  revealOutput: (jobId) => ipcRenderer.invoke(IPC.reveal, jobId),
  onJobEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: JobEvent) => listener(payload);
    ipcRenderer.on(IPC.event, wrapped);
    return () => ipcRenderer.removeListener(IPC.event, wrapped);
  },
};

contextBridge.exposeInMainWorld("sermonCleaner", api);
