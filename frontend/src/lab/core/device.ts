// 브라우저 기능 검사. 검사(probe)와 판정(tabSupport)을 나눠 판정은 노드에서 테스트한다.

import type { Requirement } from "../tabs";

export interface DeviceCaps {
  webgl2: boolean;
  /** float32 텍스처에 그리기 (EXT_color_buffer_float). 격자 볼츠만 분포함수 저장에 필요 */
  floatRenderTarget: boolean;
  webgpu: boolean;
  /** 사람이 읽는 GPU 이름 (모르면 null) */
  gpuName: string | null;
}

export type Support = { ok: true } | { ok: false; reason: string };

export function tabSupport(requires: Requirement, caps: DeviceCaps): Support {
  switch (requires) {
    case "none":
      return { ok: true };
    case "webgl2-float":
      if (!caps.webgl2) return { ok: false, reason: "이 브라우저는 WebGL2를 지원하지 않습니다." };
      if (!caps.floatRenderTarget)
        return { ok: false, reason: "이 기기의 그래픽이 float 텍스처 그리기(EXT_color_buffer_float)를 지원하지 않습니다." };
      return { ok: true };
    case "webgpu":
      if (!caps.webgpu) return { ok: false, reason: "이 브라우저는 WebGPU를 지원하지 않습니다. 최신 Chrome·Edge를 쓰세요." };
      return { ok: true };
  }
}

/** 실제 브라우저에서 기능을 검사한다. 캔버스는 검사 뒤 버린다. */
export async function probeDevice(doc: Document = document, nav: Navigator = navigator): Promise<DeviceCaps> {
  let webgl2 = false;
  let floatRenderTarget = false;
  let gpuName: string | null = null;
  const gl = doc.createElement("canvas").getContext("webgl2");
  if (gl) {
    webgl2 = true;
    floatRenderTarget = gl.getExtension("EXT_color_buffer_float") !== null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (info) gpuName = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  let webgpu = false;
  const gpu = (nav as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu) {
    try {
      webgpu = (await gpu.requestAdapter()) !== null;
    } catch {
      webgpu = false;
    }
  }
  return { webgl2, floatRenderTarget, webgpu, gpuName };
}
