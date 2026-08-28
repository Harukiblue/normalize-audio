import { _electron as electron, expect, test } from "@playwright/test";
import { stat } from "node:fs/promises";
import path from "node:path";

test("cleans a real full-length sermon through the packaged application", async () => {
  test.setTimeout(10 * 60_000);

  const executablePath = process.env.PACKAGED_ELECTRON_PATH;
  const sermonPath = process.env.REAL_SERMON_PATH;
  if (!executablePath || !sermonPath) {
    test.skip(true, "Set PACKAGED_ELECTRON_PATH and REAL_SERMON_PATH to run this validation.");
  }

  const sourceBefore = await stat(sermonPath!);
  const linuxCiArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
  const electronApp = await electron.launch({
    executablePath: executablePath!,
    args: linuxCiArgs,
  });
  const window = await electronApp.firstWindow();

  await electronApp.evaluate(async ({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedPath],
      bookmarks: [],
    });
  }, sermonPath!);

  await window.getByRole("button", { name: /choose recording/i }).click();
  await expect(window.getByText(path.basename(sermonPath!))).toBeVisible();
  const slider = window.getByRole("slider", { name: /output volume/i });
  await expect(slider).toBeVisible({ timeout: 60_000 });
  await slider.fill("-20");
  await expect(window.getByText("Quieter (-20 LUFS)")).toBeVisible();
  await window.getByRole("button", { name: /clean full recording/i }).click();
  await expect(window.getByRole("heading", { name: /your sermon is ready/i })).toBeVisible({
    timeout: 9 * 60_000,
  });

  const savedText = await window.locator(".saved-path span").textContent();
  expect(savedText).toBeTruthy();
  const outputPath = savedText!;
  const output = await stat(outputPath);
  const sourceAfter = await stat(sermonPath!);

  expect(output.size).toBeGreaterThan(1_000_000);
  expect(sourceAfter.size).toBe(sourceBefore.size);
  expect(sourceAfter.mtimeMs).toBe(sourceBefore.mtimeMs);
  await expect(window.getByText("Normalized to -20 LUFS")).toBeVisible();

  console.log(`REAL_SERMON_OUTPUT=${outputPath}`);
  await electronApp.close();
});
