import { defineConfig } from "@playwright/test";

// 브라우저에서만 도는 검사(WebGL2 셰이더 등). 노드 vitest로는 GPU 경로를 확인할 수 없다.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  use: { baseURL: "http://localhost:4180" },
  projects: [{ name: "chromium", use: { browserName: "chromium", launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } } }],
  webServer: { command: "npx vite --port 4180 --strictPort", port: 4180, reuseExistingServer: !process.env.CI },
});
