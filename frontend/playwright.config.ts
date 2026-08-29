import { defineConfig, devices } from "@playwright/test"

// The API pins CORS to localhost:5173 (app/main.py), so the app has to be driven
// on exactly that origin — a preview server on another port would be blocked.
export const APP_URL = "http://localhost:5173"
export const API_URL = "http://localhost:8000"

export default defineConfig({
  testDir: "./e2e",
  // These specs share one dev database, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/globalSetup.ts",
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  // The backend is docker compose's job; this only covers the dev server, and
  // hands back one that is already running rather than fighting it for the port.
  webServer: {
    command: "npm run dev",
    url: APP_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
