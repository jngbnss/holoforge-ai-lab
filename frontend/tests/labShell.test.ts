import { describe, expect, it } from "vitest";
import { type DeviceCaps, tabSupport } from "../src/lab/core/device";
import { LAB_TABS, labTabHash, parseLabTab } from "../src/lab/tabs";

const full: DeviceCaps = { webgl2: true, floatRenderTarget: true, webgpu: true, gpuName: null };

describe("lab tabs", () => {
  it("parses hashes and falls back to cad", () => {
    expect(parseLabTab("#/stress")).toBe("stress");
    expect(parseLabTab("#heat")).toBe("heat");
    expect(parseLabTab("")).toBe("cad");
    expect(parseLabTab("#/assemble")).toBe("cad");
    for (const t of LAB_TABS) expect(parseLabTab(labTabHash(t.id))).toBe(t.id);
  });
});

describe("tabSupport", () => {
  it("allows everything on a full device", () => {
    for (const t of LAB_TABS) expect(tabSupport(t.requires, full)).toEqual({ ok: true });
  });

  it("blocks the 2D tunnel without WebGL2 or float render targets, with distinct reasons", () => {
    const noGl = tabSupport("webgl2-float", { ...full, webgl2: false, floatRenderTarget: false });
    const noFloat = tabSupport("webgl2-float", { ...full, floatRenderTarget: false });
    expect(noGl.ok).toBe(false);
    expect(noFloat.ok).toBe(false);
    if (!noGl.ok && !noFloat.ok) {
      expect(noGl.reason).toContain("WebGL2");
      expect(noFloat.reason).toContain("EXT_color_buffer_float");
    }
  });

  it("blocks the 3D tunnel without WebGPU but keeps FEA tabs available", () => {
    const caps = { ...full, webgpu: false };
    expect(tabSupport("webgpu", caps).ok).toBe(false);
    expect(tabSupport("none", { webgl2: false, floatRenderTarget: false, webgpu: false, gpuName: null }).ok).toBe(true);
  });
});
