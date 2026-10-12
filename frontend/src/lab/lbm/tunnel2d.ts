// 2D 풍동 실행기: GPU 해석기 + 격자 선택 + 시도 측정(정착·수렴·비정상 판정). 화면과 분리해 둔다.

import { GpuLbm2D } from "./gpu2d";
import { naca00, placeAirfoil, rasterize, type Pt } from "./geometry2d";
import { converged, isUnsteady, mean, sheddingStrouhal, std, type Preset } from "../lesson/trial";

export interface GridSpec {
  name: string;
  nx: number;
  ny: number;
  chord: number;
  u: number;
  re: number;
}

/** 기본 격자(설계 D-1)와 느린 기기용 작은 격자(D-4b) */
export const GRIDS: Record<"full" | "small", GridSpec> = {
  full: { name: "768x256", nx: 768, ny: 256, chord: 80, u: 0.08, re: 500 },
  small: { name: "384x128", nx: 384, ny: 128, chord: 40, u: 0.1, re: 500 },
};

export const MIN_STEPS_PER_SEC = 1200;
/** 힘을 읽는 간격(스텝). 매 프레임 읽으면 GPU가 멈춘다 */
export const SAMPLE_EVERY = 50;

export type Phase = "settling" | "measuring" | "ready" | "unstable";

export interface Live {
  phase: Phase;
  progress: number;
  cl: number;
  cd: number;
  clStd: number;
  unsteady: boolean;
  strouhal: number | null;
  steps: number;
}

export function shapeFor(preset: Preset, f1Section: Pt[][] | null): Pt[][] {
  if (preset === "f1-front" && f1Section) return f1Section;
  return [naca00(0.12)];
}

export class Tunnel2D {
  readonly grid: GridSpec;
  readonly sim: GpuLbm2D;
  private preset: Preset = "naca0012";
  private alpha = 4;
  private f1: Pt[][] | null = null;
  private samples: { cl: number; cd: number }[] = [];
  private sinceChange = 0;
  private pendingSteps = 0;
  phase: Phase = "settling";

  constructor(gl: WebGL2RenderingContext, grid: GridSpec) {
    this.grid = grid;
    const nu = (grid.u * grid.chord) / grid.re;
    this.sim = new GpuLbm2D(gl, { nx: grid.nx, ny: grid.ny, nu, inflow: () => grid.u, walls: "freeslip", smagorinsky: 0.1 });
    this.applyShape();
    this.sim.reset();
  }

  /** 대류 시간 c/u (스텝) */
  get convective(): number {
    return Math.round(this.grid.chord / this.grid.u);
  }

  setF1Section(section: Pt[][] | null): void {
    this.f1 = section;
    if (this.preset === "f1-front") this.applyShape();
  }

  setPreset(p: Preset): void {
    this.preset = p;
    this.applyShape();
  }

  setAlpha(a: number): void {
    this.alpha = a;
    this.applyShape();
  }

  private applyShape(): void {
    const { nx, ny, chord } = this.grid;
    const polys = shapeFor(this.preset, this.f1).map((p) => placeAirfoil(p, chord, [nx * 0.26, ny * 0.5], this.alpha));
    this.sim.setSolid(rasterize(nx, ny, polys));
    this.samples = [];
    this.sinceChange = 0;
    this.phase = "settling";
  }

  /** 계수 변환: C = F / (½ ρ u² c), ρ₀=1. F1(뒤집힌 날개)은 다운포스가 +가 되게 부호를 뒤집는다 */
  private coeffs(fx: number, fy: number): { cl: number; cd: number } {
    const q = 0.5 * this.grid.u * this.grid.u * this.grid.chord;
    const sign = this.preset === "f1-front" ? -1 : 1;
    return { cl: (sign * fy) / q, cd: fx / q };
  }

  /** steps만큼 진행. SAMPLE_EVERY마다 힘을 읽고 상태를 갱신한다 */
  advance(steps: number): void {
    if (this.phase === "unstable") return;
    this.pendingSteps += steps;
    while (this.pendingSteps >= SAMPLE_EVERY) {
      this.sim.step(SAMPLE_EVERY);
      this.pendingSteps -= SAMPLE_EVERY;
      this.sinceChange += SAMPLE_EVERY;
      const f = this.sim.pendingForce();
      if (!Number.isFinite(f.fx) || !Number.isFinite(f.fy) || Math.abs(f.fx) > 1e3) {
        this.phase = "unstable";
        return;
      }
      if (this.sinceChange >= 8 * this.convective) this.samples.push(this.coeffs(f.fx, f.fy));
    }
    this.updatePhase();
  }

  /** 측정 창: 대류 시간 6배. Re=500 와류 주기(약 c/(0.2u) = 5 c/u)보다 길어야 주기 평균이 비교된다 */
  private windowLen(): number {
    return Math.max(4, Math.round((6 * this.convective) / SAMPLE_EVERY));
  }

  private updatePhase(): void {
    const w = this.windowLen();
    if (this.sinceChange < 8 * this.convective) {
      this.phase = "settling";
      return;
    }
    if (this.samples.length < 2 * w) {
      this.phase = "measuring";
      return;
    }
    const cls = this.samples.map((s) => s.cl);
    const prev = cls.slice(-2 * w, -w);
    const last = cls.slice(-w);
    // 출렁이는 흐름은 창 평균끼리 비교한다 (주기 평균이 같으면 수렴)
    this.phase = converged(prev, last) ? "ready" : "measuring";
  }

  live(): Live {
    const w = this.windowLen();
    const last = this.samples.slice(-w);
    const cls = last.map((s) => s.cl);
    const total = 8 * this.convective + 2 * w * SAMPLE_EVERY;
    const two = this.samples.slice(-2 * w).map((s) => s.cl);
    return {
      phase: this.phase,
      progress: Math.min(1, this.sinceChange / total),
      cl: cls.length ? mean(cls) : NaN,
      cd: last.length ? mean(last.map((s) => s.cd)) : NaN,
      clStd: cls.length ? std(cls) : NaN,
      unsteady: cls.length >= w && isUnsteady(cls),
      strouhal: two.length >= 2 * w ? sheddingStrouhal(two, SAMPLE_EVERY, this.grid.chord, this.grid.u) : null,
      steps: this.sim.steps,
    };
  }

  /** 기기 속도 측정: 스텝/초. 약 0.3초만 써서 화면이 오래 멈추지 않게 한다 */
  static benchmark(sim: GpuLbm2D, budgetMs = 300): number {
    sim.step(5);
    sim.pendingForce();
    const t = performance.now();
    let steps = 0;
    while (performance.now() - t < budgetMs) {
      sim.step(10);
      sim.pendingForce(); // readPixels로 GPU 작업이 끝날 때까지 기다림
      steps += 10;
    }
    return (steps * 1000) / (performance.now() - t);
  }
}
