import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  testIgnore: process.env.REAL_SERMON_PATH ? undefined : "**/real-sermon.spec.ts",
  use: {
    trace: "retain-on-failure",
  },
});
