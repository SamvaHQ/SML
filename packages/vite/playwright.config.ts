import { env } from "node:process";

import { defineConfig, devices } from "@playwright/test";

const CI = env.CI !== undefined;

export default defineConfig({
  testDir: "./browser-tests",
  outputDir: "test-results",
  // Tests share a temporary template project and start their own plugin server.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["line"], ["html", { outputFolder: "playwright-report" }]] : "line",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
