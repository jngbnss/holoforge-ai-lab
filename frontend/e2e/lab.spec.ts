import { expect, test } from "@playwright/test";

// 공학 실험실 페이지 흐름. 시도 기록·완료 조건·CSV 내용은 노드 단위 테스트(tests/labLesson.test.ts)가 맡는다.

test("2D 풍동: 예측을 확정해야 실험이 열리고, 흐름이 안정화 단계로 진행한다", async ({ page }) => {
  await page.goto("/lab.html#/tunnel2d");
  const alpha = page.getByTestId("alpha");
  await expect(alpha).toBeDisabled({ timeout: 30_000 }); // 소프트웨어 GPU에서는 첫 속도 측정이 느리다
  await page.getByTestId("prediction").fill("양력도 두 배가 될 것이다");
  await page.getByTestId("lock-prediction").click();
  await expect(alpha).toBeEnabled();
  await expect(page.getByTestId("prediction")).toBeDisabled();
  await expect(page.getByTestId("readout")).toHaveAttribute("data-phase", /settling|measuring|ready/, { timeout: 60_000 });
  await expect(page.getByTestId("record")).toBeDisabled(); // 안정화 전에는 기록 불가
});

test("2D 풍동: 새 세션은 저장된 예측을 지운다", async ({ page }) => {
  await page.goto("/lab.html#/tunnel2d");
  await page.getByTestId("prediction").fill("지울 예측", { timeout: 30_000 });
  await page.getByTestId("lock-prediction").click();
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("new-session").click();
  await expect(page.getByTestId("prediction")).toHaveValue("");
  await expect(page.getByTestId("prediction")).toBeEnabled();
});

test("float 텍스처를 못 쓰는 기기에서는 2D 풍동 대신 안내를 보여 준다", async ({ page }) => {
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype as unknown as { getExtension(name: string): unknown };
    const orig = proto.getExtension;
    proto.getExtension = function (this: WebGL2RenderingContext, name: string) {
      return name === "EXT_color_buffer_float" ? null : orig.call(this, name);
    };
  });
  await page.goto("/lab.html#/tunnel2d");
  await expect(page.getByTestId("unsupported")).toContainText("EXT_color_buffer_float");
});

test("그래픽 컨텍스트를 잃으면 멈춘 화면 대신 안내를 보여 준다", async ({ page }) => {
  await page.goto("/lab.html#/tunnel2d");
  await expect(page.getByTestId("readout")).toHaveAttribute("data-phase", /settling|measuring|ready/, { timeout: 60_000 });
  await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>("[data-testid=tunnel2d-canvas]")!;
    c.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext();
  });
  await expect(page.getByTestId("context-lost")).toBeVisible();
});

test("기어박스 앱에서 실험실로 가는 링크가 있다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("lab-link")).toHaveAttribute("href", "./lab.html");
});
