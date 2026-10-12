import { expect, test } from "@playwright/test";

// GPU(WebGL2) 해석기가 CPU 기준 구현과 같은 결과를 내는지. 셰이더의 인덱스·경계·충돌 버그를 잡는다.
const cases = [
  { name: "free-slip 풍동 + NACA0012 8° + Smagorinsky", nx: 96, ny: 48, steps: 300, walls: "freeslip", smagorinsky: 0.1, shape: "naca" },
  { name: "no-slip 채널 + 원기둥", nx: 96, ny: 40, steps: 300, walls: "noslip", smagorinsky: 0, shape: "circle" },
] as const;

for (const c of cases) {
  test(`GPU = CPU: ${c.name}`, async ({ page }) => {
    await page.goto("/e2e/gpu2d.html");
    await page.waitForFunction(() => typeof window.compareGpu === "function");
    const r = await page.evaluate((arg) => window.compareGpu(arg), { ...c });
    expect(r.maxErr).toBeLessThan(1e-4);
    const scale = Math.max(1e-6, Math.hypot(r.cpuForce[0], r.cpuForce[1]));
    expect(Math.abs(r.gpuForce[0] - r.cpuForce[0]) / scale).toBeLessThan(1e-3);
    expect(Math.abs(r.gpuForce[1] - r.cpuForce[1]) / scale).toBeLessThan(1e-3);
  });
}
