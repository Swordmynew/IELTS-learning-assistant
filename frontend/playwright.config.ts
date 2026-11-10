import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3000", viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure" },
  timeout: 30000,
});
