import { _electron as electron, expect, test } from "@playwright/test";

test("launches the packaged UI with its private, upload-only workflow", async () => {
  const executablePath = process.env.PACKAGED_ELECTRON_PATH;
  const electronApp = await electron.launch(
    executablePath ? { executablePath } : { args: ["."] },
  );
  const window = await electronApp.firstWindow();

  await expect(window).toHaveTitle("Sermon Audio Cleaner");
  await expect(window.getByRole("heading", { name: /make every word easier to hear/i })).toBeVisible();
  await expect(window.getByRole("button", { name: /choose recording/i })).toBeVisible();
  await expect(window.getByText("No AI", { exact: true })).toBeVisible();
  await expect(window.getByText("Private & offline", { exact: true })).toBeVisible();

  await electronApp.close();
});
