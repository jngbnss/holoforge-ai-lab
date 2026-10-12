// GPU↔CPU 비교 하네스. Playwright가 window.compareGpu(...)를 부른다.
import { Lbm2D, type Lbm2DOptions } from "../src/lab/lbm/d2q9";
import { GpuLbm2D } from "../src/lab/lbm/gpu2d";
import { circleMask, naca00, placeAirfoil, rasterize } from "../src/lab/lbm/geometry2d";

interface Case {
  nx: number;
  ny: number;
  steps: number;
  walls: Lbm2DOptions["walls"];
  smagorinsky: number;
  shape: "circle" | "naca";
}

declare global {
  interface Window {
    compareGpu: (c: Case) => { maxErr: number; at: [number, number, number]; cpuForce: [number, number]; gpuForce: [number, number] };
  }
}

window.compareGpu = (c) => {
  const opts: Lbm2DOptions = { nx: c.nx, ny: c.ny, nu: 0.02, inflow: () => 0.06, walls: c.walls, smagorinsky: c.smagorinsky };
  const mask =
    c.shape === "circle"
      ? circleMask(c.nx, c.ny, c.nx * 0.3, c.ny * 0.5, c.ny * 0.15)
      : rasterize(c.nx, c.ny, [placeAirfoil(naca00(0.12), c.nx * 0.4, [c.nx * 0.2, c.ny * 0.5], 8)]);
  const cpu = new Lbm2D(opts);
  cpu.setSolid(mask);
  cpu.reset();
  const canvas = document.getElementById("c") as HTMLCanvasElement;
  const gl = canvas.getContext("webgl2")!;
  const gpu = new GpuLbm2D(gl, opts);
  gpu.setSolid(mask);
  gpu.reset();
  for (let s = 0; s < c.steps; s++) cpu.step();
  gpu.step(c.steps - 1);
  const gf = gpu.pendingForce(); // CPU가 마지막 스텝에서 잰 힘과 같은 시점
  gpu.step(1);
  const g = gpu.readF();
  let maxErr = 0;
  let at: [number, number, number] = [0, 0, 0];
  const n = c.nx * c.ny;
  for (let i = 0; i < g.length; i++) {
    const e = Math.abs(g[i]! - cpu.f[i]!);
    if (e > maxErr) {
      maxErr = e;
      at = [Math.floor(i / n), (i % n) % c.nx, Math.floor((i % n) / c.nx)];
    }
  }
  return { maxErr, at, cpuForce: [cpu.lastForce.fx, cpu.lastForce.fy], gpuForce: [gf.fx, gf.fy] };
};
