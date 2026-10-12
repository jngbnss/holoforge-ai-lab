/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // wasm: Rapier(낙하 연출) wasm을 별도 파일로 둔다 (JS 청크에 base64로 넣지 않음)
  plugins: [react(), wasm()],
  build: {
    // three는 나눌 수 없는 단일 라이브러리(약 740kB, gzip 187kB)라 기준을 그 위로 둔다.
    // 이 값을 넘는 청크가 생기면 앱 코드가 커진 것이므로 경고를 본다.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      // 페이지 두 개: 기어박스 실습(index)과 공학 실험실(lab). 같은 빌드·같은 Pages 배포.
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        lab: fileURLToPath(new URL("./lab.html", import.meta.url)),
      },
      output: {
        // 자주 안 바뀌는 라이브러리를 앱 코드와 나눠 캐시되게 한다
        codeSplitting: {
          groups: [
            { name: "three", priority: 3, test: /node_modules\/three\// },
            { name: "react", priority: 2, test: /node_modules\/(react|react-dom|scheduler|zustand)\// },
            { name: "r3f", priority: 1, test: /node_modules\/(@react-three|three-stdlib|camera-controls|maath)\// },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": process.env.HOLOFORGE_API_URL ?? "http://localhost:8000" },
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
