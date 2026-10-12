// 풍동 시도 기록 규칙 (설계 D-3·D7·D12). 모두 순수 함수.

export type Preset = "naca0012" | "f1-front";

export interface TrialConditions {
  preset: Preset;
  geometryVersion: string;
  /** lift = 양력 +, downforce = 아래로 누르는 힘 + (F1은 뒤집힌 날개) */
  signConvention: "lift" | "downforce";
  grid: string;
  re: number;
}

export interface Trial extends TrialConditions {
  alphaDeg: number;
  cl: number;
  clStd: number;
  cd: number;
  /** 시간에 따라 출렁임 (비정상 변동) */
  unsteady: boolean;
  /** 주기가 확인된 와류 흘림 */
  shedding: boolean;
  strouhal: number | null;
}

export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return xs.length ? s / xs.length : NaN;
}

export function std(xs: ArrayLike<number>): number {
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i]! - m) ** 2;
  return xs.length ? Math.sqrt(s / xs.length) : NaN;
}

/** 마지막 두 창의 평균 차이가 max(2%·|평균|, 0.01) 이내면 수렴 */
export function converged(prevWindow: ArrayLike<number>, lastWindow: ArrayLike<number>): boolean {
  const a = mean(prevWindow);
  const b = mean(lastWindow);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(0.02 * Math.abs(b), 0.01);
}

/** 표준편차가 max(0.1·|평균|, 0.02)를 넘으면 비정상 변동. α≈0에서 평균≈0이라도 잡음으로 켜지지 않게 바닥값 0.02 */
export function isUnsteady(window: ArrayLike<number>): boolean {
  return std(window) > Math.max(0.1 * Math.abs(mean(window)), 0.02);
}

/**
 * 평균을 위로 지나는 영점 교차로 주기를 잰다. 연속 주기 2개 이상이 ±10% 안에서 같으면 와류 흘림으로 보고
 * 스트로할 수(St = 시위/(주기·유속))를 돌려준다. 아니면 null.
 */
export function sheddingStrouhal(samples: ArrayLike<number>, sampleEvery: number, chord: number, u: number): number | null {
  const m = mean(samples);
  const ups: number[] = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1]! < m && samples[i]! >= m) ups.push(i);
  const periods = ups.slice(1).map((v, k) => v - ups[k]!);
  if (periods.length < 2) return null;
  const last = periods.slice(-3);
  const pm = mean(last);
  if (last.some((p) => Math.abs(p - pm) > 0.1 * pm)) return null;
  return chord / (pm * sampleEvery * u);
}

/** 같은 α·같은 형상은 덮어쓴다 */
export function upsertTrial(trials: Trial[], t: Trial): Trial[] {
  const out = trials.filter((x) => !(x.preset === t.preset && Math.abs(x.alphaDeg - t.alphaDeg) < 1e-9));
  out.push(t);
  return out.sort((a, b) => (a.preset === b.preset ? a.alphaDeg - b.alphaDeg : a.preset.localeCompare(b.preset)));
}

export interface Completion {
  done: boolean;
  distinctAngles: number;
  hasSmall: boolean;
  hasLarge: boolean;
  missing: string[];
}

/** 설명 단계 열림 조건: 서로 다른 α 3개 이상, α≤4° 1개 이상, α≥12° 1개 이상 (형상 하나 안에서) */
export function completion(trials: Trial[], preset: Preset): Completion {
  const angles = [...new Set(trials.filter((t) => t.preset === preset).map((t) => t.alphaDeg))];
  const hasSmall = angles.some((a) => a <= 4);
  const hasLarge = angles.some((a) => a >= 12);
  const missing: string[] = [];
  if (angles.length < 3) missing.push(`서로 다른 받음각 ${3 - angles.length}개 더`);
  if (!hasSmall) missing.push("4° 이하 1개");
  if (!hasLarge) missing.push("12° 이상 1개");
  return { done: missing.length === 0, distinctAngles: angles.length, hasSmall, hasLarge, missing };
}
