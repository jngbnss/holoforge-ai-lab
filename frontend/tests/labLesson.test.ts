import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../src/lab/lesson/csv";
import {
  type Trial,
  completion,
  converged,
  isUnsteady,
  sheddingStrouhal,
  upsertTrial,
} from "../src/lab/lesson/trial";
import { explain } from "../src/lab/lesson/tutor";
import { circleMask, naca00, placeAirfoil, rasterize } from "../src/lab/lbm/geometry2d";

const base: Trial = {
  preset: "naca0012",
  geometryVersion: "naca0012-v1",
  signConvention: "lift",
  grid: "768x256",
  re: 500,
  alphaDeg: 4,
  cl: 0.3,
  clStd: 0.001,
  cd: 0.08,
  unsteady: false,
  shedding: false,
  strouhal: null,
};

describe("convergence and unsteadiness", () => {
  it("needs the last two window means to agree", () => {
    expect(converged([0.5, 0.5], [0.505, 0.505])).toBe(true);
    expect(converged([0.4, 0.4], [0.5, 0.5])).toBe(false);
    expect(converged([0.001], [0.009])).toBe(true); // 0 근처는 절대 바닥 0.01
  });

  it("does not flag noise around a zero mean as unsteady", () => {
    expect(isUnsteady([0.005, -0.005, 0.004, -0.004])).toBe(false);
    expect(isUnsteady([0.6, 0.2, 0.6, 0.2])).toBe(true);
  });

  it("reports shedding only for a regular period", () => {
    const sine = Array.from({ length: 400 }, (_, i) => Math.sin((2 * Math.PI * i) / 40));
    const st = sheddingStrouhal(sine, 10, 80, 0.08)!;
    expect(st).toBeCloseTo(80 / (40 * 10 * 0.08), 5);
    const decaying = Array.from({ length: 400 }, (_, i) => Math.exp(-i / 30) * Math.sin(i / (1 + i / 50)));
    expect(sheddingStrouhal(decaying, 10, 80, 0.08)).toBeNull();
  });
});

describe("trials and completion", () => {
  it("overwrites the same angle and keeps presets separate", () => {
    let t = upsertTrial([], base);
    t = upsertTrial(t, { ...base, cl: 0.31 });
    t = upsertTrial(t, { ...base, preset: "f1-front" });
    expect(t).toHaveLength(2);
    expect(t.find((x) => x.preset === "naca0012")!.cl).toBe(0.31);
  });

  it("requires 3 distinct angles including <=4 and >=12", () => {
    const at = (a: number) => ({ ...base, alphaDeg: a });
    expect(completion([at(4), at(4), at(4)], "naca0012").done).toBe(false);
    expect(completion([at(6), at(8), at(14)], "naca0012").missing).toEqual(["4° 이하 1개"]);
    expect(completion([at(2), at(8), at(14)], "naca0012").done).toBe(true);
    expect(completion([at(2), at(8), at(14)], "f1-front").done).toBe(false);
  });
});

describe("csv", () => {
  it("neutralises spreadsheet formulas and quotes separators", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(-0.5)).toBe("-0.5"); // 숫자 음수는 그대로
  });

  it("writes per-trial conditions and a check line", () => {
    const csv = toCsv({
      studentId: "2026001",
      sessionId: "s1",
      createdAt: "2026-10-12T00:00:00Z",
      prediction: "=1+1",
      explanation: "기울기가 낮다",
      appVersion: "lab-0.1",
      trials: [base],
    });
    expect(csv).toContain("prediction,'=1+1");
    expect(csv).toContain("preset,geometry_version,sign_convention,grid,re,alpha_deg");
    expect(csv).toContain("naca0012,naca0012-v1,lift,768x256,500,4,0.3000");
    expect(csv).toMatch(/\ncheck,[0-9a-f]{8}\n$/);
  });
});

describe("tutor", () => {
  it("picks explanations from measurements", () => {
    expect(explain({ ...base, alphaDeg: 0, cl: 0.001 }).key).toBe("zero");
    expect(explain({ ...base, alphaDeg: 6, cl: 0.3 }).key).toBe("below-theory");
    expect(explain({ ...base, alphaDeg: 14, unsteady: true, clStd: 0.1 }).key).toBe("unsteady");
    expect(explain({ ...base, alphaDeg: 16, unsteady: true, shedding: true, strouhal: 0.2 }).key).toBe("shedding");
    expect(explain({ ...base, preset: "f1-front", signConvention: "downforce" }).key).toBe("f1-steady");
  });
});

describe("geometry2d", () => {
  it("builds a closed NACA0012 with 12% thickness", () => {
    const p = naca00(0.12);
    const ys = p.map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.12, 2);
  });

  it("rasterizes an airfoil and a circle with the expected area", () => {
    const mask = rasterize(200, 100, [placeAirfoil(naca00(0.12), 80, [40, 50], 0)]);
    const area = mask.reduce((a, b) => a + b, 0);
    expect(area).toBeGreaterThan(0.08 * 80 * 80 * 0.9); // NACA0012 단면적 ≈ 0.082c²
    expect(area).toBeLessThan(0.082 * 80 * 80 * 1.1);
    const circ = circleMask(100, 100, 50, 50, 20).reduce((a, b) => a + b, 0);
    expect(Math.abs(circ - Math.PI * 400) / (Math.PI * 400)).toBeLessThan(0.02);
  });

  it("rotates nose-up for positive alpha", () => {
    const p = placeAirfoil([[0, 0], [1, 0]], 100, [0, 0], 10);
    expect(p[0]![1]).toBeGreaterThan(p[1]![1]); // 앞전이 뒷전보다 위
  });
});
