// D2Q9 격자 볼츠만 CPU 기준 구현. GPU 셰이더(gpu2d.ts)와 같은 순서로 계산해서 비교 테스트의 기준이 된다.
//
// 한 스텝 = 당기기(pull) 스트리밍 + 경계 처리 + 충돌(BGK, 선택적으로 Smagorinsky).
// 배열에는 "충돌 직후" 분포함수를 저장한다. 레이아웃: f[q * n + y * nx + x].
// 좌표: x는 오른쪽(유입 → 유출), y는 위쪽. 격자 단위(dx = dt = 1, 음속² = 1/3).

export const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1] as const;
export const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1] as const;
export const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36] as const;
/** 반대 방향 */
export const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6] as const;
/** y 성분만 뒤집은 방향 (free-slip 반사) */
export const MIRROR_Y = [0, 1, 4, 3, 2, 8, 7, 6, 5] as const;

export type WallMode = "freeslip" | "noslip";

export interface Lbm2DOptions {
  nx: number;
  ny: number;
  /** 동점성계수(격자 단위). τ = 3ν + 0.5 */
  nu: number;
  /** 유입 속도 분포. y(셀 인덱스) → ux. 기본은 균일 u0 */
  inflow: (y: number) => number;
  /** 위·아래 벽: free-slip(풍동) 또는 no-slip(DFG 채널) */
  walls: WallMode;
  /** Smagorinsky 상수 (0이면 끔) */
  smagorinsky: number;
}

export interface Force {
  fx: number;
  fy: number;
}

export function equilibrium(q: number, rho: number, ux: number, uy: number): number {
  const cu = 3 * (CX[q]! * ux + CY[q]! * uy);
  return W[q]! * rho * (1 + cu + 0.5 * cu * cu - 1.5 * (ux * ux + uy * uy));
}

/** τ_eff (Hou 1996): 비평형 응력 크기로 난류 점성을 더한다 */
export function smagorinskyTau(tau: number, cs: number, rho: number, piNorm: number): number {
  if (cs <= 0) return tau;
  return 0.5 * (tau + Math.sqrt(tau * tau + (18 * Math.SQRT2 * cs * cs * piNorm) / rho));
}

export class Lbm2D {
  readonly nx: number;
  readonly ny: number;
  readonly n: number;
  readonly tau: number;
  /** 충돌 직후 분포함수 */
  f: Float32Array;
  private next: Float32Array;
  /** 0 = 유체, 1 = 물체(힘을 잼). 벽은 경계 조건으로 처리한다 */
  solid: Uint8Array;
  readonly opts: Lbm2DOptions;
  /** 마지막 스텝에서 물체가 받은 힘 */
  lastForce: Force = { fx: 0, fy: 0 };
  steps = 0;
  /** 경계 처리가 필요한 셀(격자 가장자리 또는 물체 옆). 나머지는 빠른 경로 */
  private special: Uint8Array;
  private inflowU: Float64Array;
  private fin = new Float64Array(9);

  constructor(opts: Lbm2DOptions) {
    this.opts = opts;
    this.nx = opts.nx;
    this.ny = opts.ny;
    this.n = opts.nx * opts.ny;
    this.tau = 3 * opts.nu + 0.5;
    this.f = new Float32Array(9 * this.n);
    this.next = new Float32Array(9 * this.n);
    this.solid = new Uint8Array(this.n);
    this.special = new Uint8Array(this.n);
    this.inflowU = Float64Array.from({ length: opts.ny }, (_, y) => opts.inflow(y));
    this.markSpecial();
    this.reset();
  }

  /** 모든 유체 셀을 유입 속도의 평형 상태로 */
  reset(): void {
    for (let y = 0; y < this.ny; y++) {
      const ux = this.inflowU[y]!;
      for (let x = 0; x < this.nx; x++) {
        const i = y * this.nx + x;
        const u = this.solid[i] ? 0 : ux;
        for (let q = 0; q < 9; q++) this.f[q * this.n + i] = equilibrium(q, 1, u, 0);
      }
    }
    this.steps = 0;
  }

  /** 물체 모양을 바꾼다. 물체였다가 유체가 된 셀은 정지 평형(ρ=1, u=0)으로 둔다 */
  setSolid(mask: Uint8Array): void {
    for (let i = 0; i < this.n; i++) {
      if (this.solid[i] && !mask[i]) for (let q = 0; q < 9; q++) this.f[q * this.n + i] = W[q]!;
    }
    this.solid.set(mask);
    this.markSpecial();
  }

  private markSpecial(): void {
    const { nx, ny, solid, special } = this;
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        let s = x === 0 || y === 0 || x === nx - 1 || y === ny - 1 ? 1 : 0;
        for (let q = 1; q < 9 && !s; q++) if (solid[(y - CY[q]!) * nx + (x - CX[q]!)]) s = 1;
        special[y * nx + x] = s;
      }
    }
  }

  step(): void {
    const { nx, ny, n, f, next, solid, tau, special, inflowU } = this;
    const cs = this.opts.smagorinsky;
    const noslip = this.opts.walls === "noslip";
    const fin = this.fin;
    let fx = 0;
    let fy = 0;
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        if (solid[i]) {
          for (let q = 0; q < 9; q++) next[q * n + i] = f[q * n + i]!;
          continue;
        }
        if (!special[i]) {
          // 안쪽 셀: 이웃이 모두 유체이고 격자 안
          fin[0] = f[i]!;
          fin[1] = f[n + i - 1]!;
          fin[2] = f[2 * n + i - nx]!;
          fin[3] = f[3 * n + i + 1]!;
          fin[4] = f[4 * n + i + nx]!;
          fin[5] = f[5 * n + i - nx - 1]!;
          fin[6] = f[6 * n + i - nx + 1]!;
          fin[7] = f[7 * n + i + nx + 1]!;
          fin[8] = f[8 * n + i + nx - 1]!;
        } else {
          for (let q = 0; q < 9; q++) {
            let sx = x - CX[q]!;
            let sy = y - CY[q]!;
            if (sx >= 0 && sx < nx && sy >= 0 && sy < ny && solid[sy * nx + sx]) {
              // 물체에서 튕겨 나옴 (halfway bounce-back) + 운동량 교환
              const o = OPP[q]!;
              const fo = f[o * n + i]!;
              fin[q] = fo;
              fx += 2 * fo * CX[o]!;
              fy += 2 * fo * CY[o]!;
              continue;
            }
            let qq = q;
            if (sy < 0 || sy >= ny) {
              if (noslip) {
                fin[q] = f[OPP[q]! * n + i]!;
                continue;
              }
              // free-slip: y 방향만 거울 반사
              sy = y;
              qq = MIRROR_Y[q]!;
            }
            if (sx < 0) sx = 0; // 입구·출구 셀은 아래에서 평형 경계로 덮어쓴다
            else if (sx >= nx) sx = nx - 1;
            fin[q] = f[qq * n + sy * nx + sx]!;
          }
          if (x === 0) {
            // 입구: 평형 경계, u=유입 속도, ρ=바로 안쪽 셀 (채널 압력차가 생길 수 있게). 낮은 점성에서도 반사 잡음이 적다
            let r = 0;
            for (let q = 0; q < 9; q++) r += f[q * n + i + 1]!;
            for (let q = 0; q < 9; q++) fin[q] = equilibrium(q, r, inflowU[y]!, 0);
          } else if (x === nx - 1) {
            // 출구: 평형 경계 ρ=1, u=바로 안쪽 셀(충돌 후에도 밀도·운동량은 같다)
            const j = i - 1;
            let r = 0;
            let mx = 0;
            let my = 0;
            for (let q = 0; q < 9; q++) {
              const v = f[q * n + j]!;
              r += v;
              mx += v * CX[q]!;
              my += v * CY[q]!;
            }
            for (let q = 0; q < 9; q++) fin[q] = equilibrium(q, 1, mx / r, my / r);
          }
        }
        const f0 = fin[0]!, f1 = fin[1]!, f2 = fin[2]!, f3 = fin[3]!, f4 = fin[4]!;
        const f5 = fin[5]!, f6 = fin[6]!, f7 = fin[7]!, f8 = fin[8]!;
        const rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
        const ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho;
        const uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho;
        const usq = 1.5 * (ux * ux + uy * uy);
        // 평형 분포 (W·ρ·(1 + cu + cu²/2 − 1.5u²), cu = 3 c·u)
        const r0 = (4 / 9) * rho;
        const r1 = (1 / 9) * rho;
        const r2 = (1 / 36) * rho;
        const a = 3 * ux;
        const b = 3 * uy;
        const e0 = r0 * (1 - usq);
        const e1 = r1 * (1 + a + 0.5 * a * a - usq);
        const e2 = r1 * (1 + b + 0.5 * b * b - usq);
        const e3 = r1 * (1 - a + 0.5 * a * a - usq);
        const e4 = r1 * (1 - b + 0.5 * b * b - usq);
        const c5 = a + b;
        const c6 = -a + b;
        const e5 = r2 * (1 + c5 + 0.5 * c5 * c5 - usq);
        const e6 = r2 * (1 + c6 + 0.5 * c6 * c6 - usq);
        const e7 = r2 * (1 - c5 + 0.5 * c5 * c5 - usq);
        const e8 = r2 * (1 - c6 + 0.5 * c6 * c6 - usq);
        let t = tau;
        if (cs > 0) {
          const n1 = f1 - e1, n2 = f2 - e2, n3 = f3 - e3, n4 = f4 - e4;
          const n5 = f5 - e5, n6 = f6 - e6, n7 = f7 - e7, n8 = f8 - e8;
          const pxx = n1 + n3 + n5 + n6 + n7 + n8;
          const pyy = n2 + n4 + n5 + n6 + n7 + n8;
          const pxy = n5 - n6 + n7 - n8;
          t = smagorinskyTau(tau, cs, rho, Math.sqrt(pxx * pxx + pyy * pyy + 2 * pxy * pxy));
        }
        const om = 1 / t;
        next[i] = f0 - om * (f0 - e0);
        next[n + i] = f1 - om * (f1 - e1);
        next[2 * n + i] = f2 - om * (f2 - e2);
        next[3 * n + i] = f3 - om * (f3 - e3);
        next[4 * n + i] = f4 - om * (f4 - e4);
        next[5 * n + i] = f5 - om * (f5 - e5);
        next[6 * n + i] = f6 - om * (f6 - e6);
        next[7 * n + i] = f7 - om * (f7 - e7);
        next[8 * n + i] = f8 - om * (f8 - e8);
      }
    }
    this.f = next;
    this.next = f;
    this.lastForce = { fx, fy };
    this.steps++;
  }

  /** 셀의 밀도·속도 */
  macro(x: number, y: number): { rho: number; ux: number; uy: number } {
    const i = y * this.nx + x;
    let rho = 0;
    let mx = 0;
    let my = 0;
    for (let q = 0; q < 9; q++) {
      const v = this.f[q * this.n + i]!;
      rho += v;
      mx += v * CX[q]!;
      my += v * CY[q]!;
    }
    return { rho, ux: mx / rho, uy: my / rho };
  }

  /** 계산이 터졌는지 (NaN·Inf·밀도 이탈) */
  unstable(rhoMin = 0.8, rhoMax = 1.2): boolean {
    for (let i = 0; i < this.n; i += 7) {
      if (this.solid[i]) continue;
      const { rho } = this.macro(i % this.nx, Math.floor(i / this.nx));
      if (!Number.isFinite(rho) || rho < rhoMin || rho > rhoMax) return true;
    }
    return false;
  }
}
