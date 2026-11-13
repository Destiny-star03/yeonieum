import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const root = fileURLToPath(new URL("../..", import.meta.url));
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
    baseURL: "http://127.0.0.1:5173",
    ...(process.env.CI ? {} : { channel: "chrome" }),
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `"${python}" -m uvicorn yeonieum.main:create_app --app-dir "${join(root, "apps/api/src")}" --factory --host 127.0.0.1 --port 8000`,
      url: "http://127.0.0.1:8000/api/health",
      env: {
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
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
