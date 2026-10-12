// D2Q9 격자 볼츠만 WebGL2 구현. d2q9.ts(CPU 기준)와 같은 순서·같은 경계 처리를 한다.
// 분포함수 9개를 RGBA32F 텍스처 3장에 나눠 담고(f0..3, f4..7, f8) 두 벌을 번갈아 쓴다.
// 힘은 셀별 운동량 교환을 텍스처에 쓴 뒤 절반씩 더해 1×1까지 줄여서 한 번만 읽는다.

import { type Force, type Lbm2DOptions, equilibrium } from "./d2q9";

const VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D T0; uniform sampler2D T1; uniform sampler2D T2; uniform sampler2D S;
uniform int nx; uniform int ny;
const ivec2 C[9] = ivec2[9](ivec2(0,0), ivec2(1,0), ivec2(0,1), ivec2(-1,0), ivec2(0,-1), ivec2(1,1), ivec2(-1,1), ivec2(-1,-1), ivec2(1,-1));
const int OPP[9] = int[9](0, 3, 4, 1, 2, 7, 8, 5, 6);
const int MIR[9] = int[9](0, 1, 4, 3, 2, 8, 7, 6, 5);
float fq(int q, ivec2 c) {
  if (q < 4) return texelFetch(T0, c, 0)[q];
  if (q < 8) return texelFetch(T1, c, 0)[q - 4];
  return texelFetch(T2, c, 0).r;
}
bool solidAt(ivec2 c) { return texelFetch(S, c, 0).r > 0.0; } // R8 정규화: 1 → 1/255
bool inside(ivec2 c) { return c.x >= 0 && c.y >= 0 && c.x < nx && c.y < ny; }
`;

const STEP_FS = `${COMMON}
uniform sampler2D INFLOW; uniform float tau; uniform float cs; uniform int noslip;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
const float W[9] = float[9](4.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0);
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float f[9];
  if (solidAt(c)) {
    for (int q = 0; q < 9; q++) f[q] = fq(q, c);
    o0 = vec4(f[0], f[1], f[2], f[3]); o1 = vec4(f[4], f[5], f[6], f[7]); o2 = vec4(f[8], 0.0, 0.0, 0.0);
    return;
  }
  for (int q = 0; q < 9; q++) {
    ivec2 s = c - C[q];
    if (inside(s) && solidAt(s)) { f[q] = fq(OPP[q], c); continue; }
    int qq = q;
    if (s.y < 0 || s.y >= ny) {
      if (noslip == 1) { f[q] = fq(OPP[q], c); continue; }
      s.y = c.y; qq = MIR[q];
    }
    s.x = clamp(s.x, 0, nx - 1);
    f[q] = fq(qq, s);
  }
  if (c.x == 0 || c.x == nx - 1) {
    // 평형 경계. 입구: 유입 속도·안쪽 셀 밀도, 출구: ρ=1·안쪽 셀 속도 (d2q9.ts와 같음)
    vec2 ub = vec2(texelFetch(INFLOW, ivec2(c.y, 0), 0).r, 0.0);
    float rb = 1.0;
    if (c.x == 0) { rb = 0.0; for (int q = 0; q < 9; q++) rb += fq(q, c + ivec2(1, 0)); }
    if (c.x == nx - 1) {
      ivec2 j = c - ivec2(1, 0);
      float r = 0.0; vec2 mm = vec2(0.0);
      for (int q = 0; q < 9; q++) { float v = fq(q, j); r += v; mm += v * vec2(C[q]); }
      ub = mm / r;
    }
    float us = 1.5 * dot(ub, ub);
    for (int q = 0; q < 9; q++) { float cu = 3.0 * dot(vec2(C[q]), ub); f[q] = W[q] * rb * (1.0 + cu + 0.5 * cu * cu - us); }
  }
  float rho = 0.0; vec2 m = vec2(0.0);
  for (int q = 0; q < 9; q++) { rho += f[q]; m += f[q] * vec2(C[q]); }
  vec2 u = m / rho;
  float usq = 1.5 * dot(u, u);
  float e[9];
  for (int q = 0; q < 9; q++) { float cu = 3.0 * dot(vec2(C[q]), u); e[q] = W[q] * rho * (1.0 + cu + 0.5 * cu * cu - usq); }
  float t = tau;
  if (cs > 0.0) {
    float pxx = 0.0, pyy = 0.0, pxy = 0.0;
    for (int q = 0; q < 9; q++) {
      float d = f[q] - e[q]; vec2 cq = vec2(C[q]);
      pxx += cq.x * cq.x * d; pyy += cq.y * cq.y * d; pxy += cq.x * cq.y * d;
    }
    float pn = sqrt(pxx * pxx + pyy * pyy + 2.0 * pxy * pxy);
    t = 0.5 * (tau + sqrt(tau * tau + 18.0 * 1.41421356 * cs * cs * pn / rho));
  }
  float om = 1.0 / t;
  for (int q = 0; q < 9; q++) f[q] = f[q] - om * (f[q] - e[q]);
  o0 = vec4(f[0], f[1], f[2], f[3]); o1 = vec4(f[4], f[5], f[6], f[7]); o2 = vec4(f[8], rho, u);
}`;

// 셀별 운동량 교환 (다음 스텝에서 물체에 부딪힐 값). CPU step()의 힘 합과 같은 항
const FORCE_FS = `${COMMON}
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 F = vec2(0.0);
  if (!solidAt(c)) {
    for (int q = 1; q < 9; q++) {
      ivec2 s = c - C[q];
      if (inside(s) && solidAt(s)) F += 2.0 * fq(OPP[q], c) * vec2(C[OPP[q]]);
    }
  }
  o = vec4(F, 0.0, 1.0);
}`;

// 2×2 블록 합 (크기를 절반으로)
const REDUCE_FS = `#version 300 es
precision highp float;
uniform sampler2D A; uniform ivec2 srcSize;
out vec4 o;
void main() {
  ivec2 d = ivec2(gl_FragCoord.xy) * 2;
  vec4 s = vec4(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    ivec2 p = d + ivec2(i, j);
    if (p.x < srcSize.x && p.y < srcSize.y) s += texelFetch(A, p, 0);
  }
  o = s;
}`;

// 보기: 0 = 속도 크기, 1 = 와도. 물체는 회색
const VIEW_FS = `${COMMON}
uniform int mode; uniform float uref; uniform vec2 canvas;
out vec4 o;
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  return mix(mix(vec3(0.05, 0.1, 0.35), vec3(0.1, 0.7, 0.8), smoothstep(0.0, 0.5, t)), vec3(1.0, 0.85, 0.3), smoothstep(0.5, 1.0, t));
}
vec2 vel(ivec2 c) { vec4 a = texelFetch(T2, clamp(c, ivec2(0), ivec2(nx - 1, ny - 1)), 0); return a.ba; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy / canvas * vec2(nx, ny));
  if (solidAt(c)) { o = vec4(0.55, 0.57, 0.6, 1.0); return; }
  if (mode == 0) { o = vec4(ramp(length(vel(c)) / (1.6 * uref)), 1.0); return; }
  float w = (vel(c + ivec2(1, 0)).y - vel(c - ivec2(1, 0)).y) - (vel(c + ivec2(0, 1)).x - vel(c - ivec2(0, 1)).x);
  float t = clamp(w / (0.2 * uref), -1.0, 1.0);
  o = vec4(t > 0.0 ? mix(vec3(0.95), vec3(0.85, 0.2, 0.2), t) : mix(vec3(0.95), vec3(0.2, 0.35, 0.85), -t), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VS],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`셰이더 컴파일 실패: ${gl.getShaderInfoLog(sh)}`);
    gl.attachShader(prog, sh);
  }
  gl.bindAttribLocation(prog, 0, "p");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`셰이더 링크 실패: ${gl.getProgramInfoLog(prog)}`);
  return prog;
}

interface Buffers {
  tex: [WebGLTexture, WebGLTexture, WebGLTexture];
  fbo: WebGLFramebuffer;
}

export class GpuLbm2D {
  readonly nx: number;
  readonly ny: number;
  readonly tau: number;
  steps = 0;
  private gl: WebGL2RenderingContext;
  private opts: Lbm2DOptions;
  private bufs: [Buffers, Buffers];
  private cur = 0;
  private solidTex: WebGLTexture;
  private inflowTex: WebGLTexture;
  private stepProg: WebGLProgram;
  private forceProg: WebGLProgram;
  private reduceProg: WebGLProgram;
  private viewProg: WebGLProgram;
  private reduceChain: { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }[] = [];
  private solidMask: Uint8Array;

  constructor(gl: WebGL2RenderingContext, opts: Lbm2DOptions) {
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float 없음");
    this.gl = gl;
    this.opts = opts;
    this.nx = opts.nx;
    this.ny = opts.ny;
    this.tau = 3 * opts.nu + 0.5;
    this.solidMask = new Uint8Array(opts.nx * opts.ny);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.stepProg = compile(gl, STEP_FS);
    this.forceProg = compile(gl, FORCE_FS);
    this.reduceProg = compile(gl, REDUCE_FS);
    this.viewProg = compile(gl, VIEW_FS);
    this.bufs = [this.makeBuffers(), this.makeBuffers()];
    this.solidTex = this.makeTex(gl.R8, gl.RED, gl.UNSIGNED_BYTE, this.nx, this.ny, this.solidMask);
    const inflow = Float32Array.from({ length: this.ny }, (_, y) => opts.inflow(y));
    this.inflowTex = this.makeTex(gl.R32F, gl.RED, gl.FLOAT, this.ny, 1, inflow);
    let w = this.nx;
    let h = this.ny;
    const first = this.makeTarget(w, h);
    this.reduceChain.push({ ...first, w, h });
    while (w > 1 || h > 1) {
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      this.reduceChain.push({ ...this.makeTarget(w, h), w, h });
    }
    this.reset();
  }

  private makeTex(internal: number, format: number, type: number, w: number, h: number, data: ArrayBufferView | null) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    return t;
  }

  private makeTarget(w: number, h: number) {
    const gl = this.gl;
    const tex = this.makeTex(gl.RGBA32F, gl.RGBA, gl.FLOAT, w, h, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  }

  private makeBuffers(): Buffers {
    const gl = this.gl;
    const tex = [0, 1, 2].map(() => this.makeTex(gl.RGBA32F, gl.RGBA, gl.FLOAT, this.nx, this.ny, null)) as Buffers["tex"];
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    tex.forEach((t, k) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("float 프레임버퍼를 만들 수 없음");
    return { tex, fbo };
  }

  /** CPU와 같은 초기 상태(유입 속도 평형)로 */
  reset(): void {
    const { nx, ny } = this;
    const d = [new Float32Array(nx * ny * 4), new Float32Array(nx * ny * 4), new Float32Array(nx * ny * 4)];
    for (let y = 0; y < ny; y++) {
      const u0 = this.opts.inflow(y);
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        const u = this.solidMask[i] ? 0 : u0;
        for (let q = 0; q < 9; q++) d[q >> 2]![i * 4 + (q & 3)] = equilibrium(q, 1, u, 0);
      }
    }
    this.upload(d);
    this.steps = 0;
  }

  private upload(d: Float32Array[]): void {
    const gl = this.gl;
    for (const b of this.bufs) {
      b.tex.forEach((t, k) => {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.nx, this.ny, gl.RGBA, gl.FLOAT, d[k]!);
      });
    }
  }

  /** 물체 모양 바꾸기. 물체→유체가 된 셀은 정지 평형으로 (CPU setSolid와 같음) */
  setSolid(mask: Uint8Array): void {
    const freed: number[] = [];
    for (let i = 0; i < mask.length; i++) if (this.solidMask[i] && !mask[i]) freed.push(i);
    if (freed.length) {
      const f = this.readF();
      const n = this.nx * this.ny;
      for (const i of freed) for (let q = 0; q < 9; q++) f[q * n + i] = q === 0 ? 4 / 9 : q < 5 ? 1 / 9 : 1 / 36;
      this.writeF(f);
    }
    this.solidMask = mask.slice();
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.solidTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.nx, this.ny, gl.RED, gl.UNSIGNED_BYTE, mask);
  }

  private bindInputs(prog: WebGLProgram, b: Buffers): void {
    const gl = this.gl;
    gl.useProgram(prog);
    const bind = (name: string, unit: number, tex: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    };
    bind("T0", 0, b.tex[0]);
    bind("T1", 1, b.tex[1]);
    bind("T2", 2, b.tex[2]);
    bind("S", 3, this.solidTex);
    gl.uniform1i(gl.getUniformLocation(prog, "nx"), this.nx);
    gl.uniform1i(gl.getUniformLocation(prog, "ny"), this.ny);
  }

  step(count = 1): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.nx, this.ny);
    for (let k = 0; k < count; k++) {
      const src = this.bufs[this.cur]!;
      const dst = this.bufs[1 - this.cur]!;
      this.bindInputs(this.stepProg, src);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.inflowTex);
      gl.uniform1i(gl.getUniformLocation(this.stepProg, "INFLOW"), 4);
      gl.uniform1f(gl.getUniformLocation(this.stepProg, "tau"), this.tau);
      gl.uniform1f(gl.getUniformLocation(this.stepProg, "cs"), this.opts.smagorinsky);
      gl.uniform1i(gl.getUniformLocation(this.stepProg, "noslip"), this.opts.walls === "noslip" ? 1 : 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.cur = 1 - this.cur;
      this.steps++;
    }
  }

  /** 다음 스텝에서 물체가 받을 힘. CPU의 lastForce는 "방금 끝난 스텝" 기준이므로 비교 시 순서를 맞춘다 */
  pendingForce(): Force {
    const gl = this.gl;
    const first = this.reduceChain[0]!;
    gl.viewport(0, 0, this.nx, this.ny);
    this.bindInputs(this.forceProg, this.bufs[this.cur]!);
    gl.bindFramebuffer(gl.FRAMEBUFFER, first.fbo);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.useProgram(this.reduceProg);
    for (let k = 1; k < this.reduceChain.length; k++) {
      const a = this.reduceChain[k - 1]!;
      const b = this.reduceChain[k]!;
      gl.viewport(0, 0, b.w, b.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.uniform1i(gl.getUniformLocation(this.reduceProg, "A"), 0);
      gl.uniform2i(gl.getUniformLocation(this.reduceProg, "srcSize"), a.w, a.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    const out = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
    return { fx: out[0]!, fy: out[1]! };
  }

  /** CPU 레이아웃(f[q*n + i])으로 읽기. 테스트·저장용(느림) */
  readF(): Float32Array {
    const gl = this.gl;
    const n = this.nx * this.ny;
    const out = new Float32Array(9 * n);
    const buf = new Float32Array(n * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bufs[this.cur]!.fbo);
    for (let k = 0; k < 3; k++) {
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + k);
      gl.readPixels(0, 0, this.nx, this.ny, gl.RGBA, gl.FLOAT, buf);
      for (let c = 0; c < 4; c++) {
        const q = k * 4 + c;
        if (q > 8) break;
        for (let i = 0; i < n; i++) out[q * n + i] = buf[i * 4 + c]!;
      }
    }
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    return out;
  }

  private writeF(f: Float32Array): void {
    const n = this.nx * this.ny;
    const d = [new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4)];
    for (let q = 0; q < 9; q++) for (let i = 0; i < n; i++) d[q >> 2]![i * 4 + (q & 3)] = f[q * n + i]!;
    this.upload(d);
  }

  /** 캔버스에 그리기. mode 0 = 속도, 1 = 와도 */
  render(mode: 0 | 1, uref: number): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    this.bindInputs(this.viewProg, this.bufs[this.cur]!);
    gl.uniform1i(gl.getUniformLocation(this.viewProg, "mode"), mode);
    gl.uniform1f(gl.getUniformLocation(this.viewProg, "uref"), uref);
    gl.uniform2f(gl.getUniformLocation(this.viewProg, "canvas"), canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
