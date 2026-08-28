import { _electron as electron, expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
let temporaryDirectory: string;
let recordingPath: string;

test.beforeAll(async () => {
  if (!ffmpegPath) throw new Error("Bundled FFmpeg is unavailable.");
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "sermon-cleaner-e2e-"));
  recordingPath = path.join(temporaryDirectory, "Preview sermon.wav");
  await run(ffmpegPath, [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:duration=8:sample_rate=48000",
    "-c:a",
    "pcm_s16le",
    recordingPath,
  ]);
});

test.afterAll(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

function launchOptions() {
  const executablePath = process.env.PACKAGED_ELECTRON_PATH;
  const linuxCiArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
  return executablePath
    ? { executablePath, args: linuxCiArgs }
    : { args: [...linuxCiArgs, "."] };
}

test("launches the packaged UI with its private, upload-only workflow", async () => {
  const electronApp = await electron.launch(launchOptions());
  const window = await electronApp.firstWindow();

  await expect(window).toHaveTitle("Sermon Audio Cleaner");
  await expect(window.getByRole("heading", { name: /make every word easier to hear/i })).toBeVisible();
  await expect(window.getByRole("button", { name: /choose recording/i })).toBeVisible();
  await expect(window.getByText("No AI", { exact: true })).toBeVisible();
  await expect(window.getByText("Private & offline", { exact: true })).toBeVisible();

  await electronApp.close();
});

test("previews a selected recording and supports keyboard loudness adjustment", async () => {
  const electronApp = await electron.launch(launchOptions());
  const window = await electronApp.firstWindow();
  await electronApp.evaluate(async ({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedPath],
      bookmarks: [],
    });
  }, recordingPath);

  await window.getByRole("button", { name: /choose recording/i }).click();
  const slider = window.getByRole("slider", { name: /output volume/i });
  await expect(slider).toBeVisible({ timeout: 30_000 });
  await expect(slider).toHaveValue("-16");
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue("-17");
  await expect(window.getByText("Quieter (-17 LUFS)")).toBeVisible();
  await window.getByRole("button", { name: /choose another recording/i }).click();
  await expect(window.getByRole("button", { name: /choose recording/i })).toBeVisible();
  await electronApp.close();
});
