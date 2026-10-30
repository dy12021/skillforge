import "dotenv/config";
import { defineConfig } from "@playwright/test";
const database =
  process.env.TEST_DATABASE_URL ??
  "postgresql://skillforge:skillforge_test@localhost:55433/skillforge_test";
if (!new URL(database).pathname.endsWith("_test"))
  throw new Error("E2E requires an isolated _test database");
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel:
      process.env.E2E_BROWSER_CHANNEL === "chromium"
        ? undefined
        : process.env.E2E_BROWSER_CHANNEL,
    launchOptions: { args: ["--disable-gpu", "--renderer-process-limit=1"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: {
    command:
      "node --import tsx scripts/prepare-test.ts && node scripts/web.mjs start --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: database,
      MODEL_PROVIDER: "mock",
      MOCK_MODE: "true",
      BASE_URL: "http://127.0.0.1:3100",
    },
  },
});
