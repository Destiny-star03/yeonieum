import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const root = fileURLToPath(new URL("../..", import.meta.url));
const apiPort = process.env.YEONIEUM_E2E_API_PORT || "8010";
const webPort = process.env.YEONIEUM_E2E_WEB_PORT || "5180";
const python =
  process.env.YEONIEUM_TEST_PYTHON ||
  (process.platform === "win32"
    ? join(root, "apps/api/.venv/Scripts/python.exe")
    : "python");
export default defineConfig({
  testDir: "../../tests/e2e",
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    ...(process.env.CI ? {} : { channel: "chrome" }),
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `"${python}" -m uvicorn yeonieum.main:create_app --app-dir "${join(root, "apps/api/src")}" --factory --host 127.0.0.1 --port ${apiPort}`,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: {
        YEONIEUM_EXTERNAL_SYNC: "0",
        YEONIEUM_WEB_PORT: webPort,
        YEONIEUM_DB_PATH: join(
          root,
          "local-data",
          `e2e-${randomUUID()}.sqlite3`,
        ),
      },
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "npm run dev",
      url: `http://127.0.0.1:${webPort}`,
      env: { YEONIEUM_WEB_PORT: webPort, YEONIEUM_API_PORT: apiPort },
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
