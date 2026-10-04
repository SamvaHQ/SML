import { env } from "node:process";

import { defineConfig, devices } from "@playwright/test";

const PORT = 5232;
const CI = env.CI !== undefined;

export default defineConfig({
  testDir: "./browser-tests",
  outputDir: "test-results",
  // Every case owns a browser context, but all cases share one Vite process.
  // Serial execution prevents independent iframe ResizeObservers from flooding
  // that process's single delivery loop and turning load into browser errors.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["line"], ["html", { outputFolder: "playwright-report" }]] : "line",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `bun run dev -- --host 127.0.0.1 --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
