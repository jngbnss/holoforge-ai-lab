// DFG 2D-1 / 2D-2 원기둥 벤치마크 (Schäfer & Turek 1996). CPU 기준 해석기의 물리 정확도 확인용.
// 실행: npm run bench:dfg -- [2d1|2d2] [지름당 셀 수]
//
// 채널 2.2 × 0.41, 원기둥 지름 0.1, 중심 (0.2, 0.2), 포물선 유입, no-slip 벽.
// 2D-1: Re=20 정상 → C_D 5.5795, C_L 0.0106
// 2D-2: Re=100 비정상 → C_D,max 3.2390, C_L,max 1.0, St 0.3000

import { Lbm2D } from "../src/lab/lbm/d2q9";
import { circleMask } from "../src/lab/lbm/geometry2d";

const which = process.argv[2] ?? "2d1";
const D = Number(process.argv[3] ?? 20);
const dx = 0.1 / D;
const nx = Math.round(2.2 / dx);
const ny = Math.round(0.41 / dx);
const re = which === "2d2" ? 100 : 20;
const uMax = which === "2d2" ? 0.06 : 0.1; // 격자 속도 (Ma 제한)
const uMean = (2 / 3) * uMax;
const nu = (uMean * D) / re;
const H = ny; // 셀 단위 채널 높이

const sim = new Lbm2D({
  nx,
  ny,
  nu,
  inflow: (y) => {
    const yy = y + 0.5;
    return (4 * uMax * yy * (H - yy)) / (H * H);
  },
  walls: "noslip",
  smagorinsky: 0,
});
sim.setSolid(circleMask(nx, ny, 0.2 / dx, 0.2 / dx, D / 2));
sim.reset();

const coef = (f: number) => (2 * f) / (uMean * uMean * D);
const t0 = performance.now();
console.log(`${which} D=${D} grid ${nx}×${ny} τ=${sim.tau.toFixed(4)} Re=${re}`);

if (which === "2d1") {
  let prev = 0;
  for (let k = 1; k <= 400; k++) {
    for (let s = 0; s < 250; s++) sim.step();
    const cd = coef(sim.lastForce.fx);
    if (k % 20 === 0) console.log(`step ${sim.steps} C_D=${cd.toFixed(4)} C_L=${coef(sim.lastForce.fy).toFixed(4)}`);
    if (k > 20 && Math.abs(cd - prev) < 1e-5) break;
    prev = cd;
  }
  const cd = coef(sim.lastForce.fx);
  const err = Math.abs(cd - 5.5795) / 5.5795;
  console.log(`RESULT C_D=${cd.toFixed(4)} (ref 5.5795, err ${(err * 100).toFixed(2)}%) C_L=${coef(sim.lastForce.fy).toFixed(4)} (ref 0.0106)`);
} else {
  const T = (0.1 / dx) / uMean; // 지름/평균속도 = 시간 단위(스텝)
  const settle = Math.round(40 * T);
  for (let s = 0; s < settle; s++) sim.step();
  let clMax = -Infinity;
  let cdMax = -Infinity;
  const crossings: number[] = [];
  let prevCl = coef(sim.lastForce.fy);
  const window = Math.round(20 * T);
  for (let s = 0; s < window; s++) {
    sim.step();
    const cl = coef(sim.lastForce.fy);
    clMax = Math.max(clMax, cl);
    cdMax = Math.max(cdMax, coef(sim.lastForce.fx));
    if (prevCl < 0 && cl >= 0) crossings.push(sim.steps);
    prevCl = cl;
  }
  const periods = crossings.slice(1).map((c, i) => c - crossings[i]!);
  const period = periods.reduce((a, b) => a + b, 0) / Math.max(1, periods.length);
  const st = (D / period) / uMean;
  console.log(
    `RESULT C_L,max=${clMax.toFixed(4)} (ref 1.0, err ${(Math.abs(clMax - 1) * 100).toFixed(1)}%) C_D,max=${cdMax.toFixed(4)} (ref 3.2390) St=${st.toFixed(4)} (ref 0.3000)`,
  );
}
console.log(`time ${((performance.now() - t0) / 1000).toFixed(1)}s, steps ${sim.steps}, MLUPS ${((sim.steps * nx * ny) / ((performance.now() - t0) * 1000)).toFixed(1)}`);
