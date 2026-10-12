// v1 튜터: 측정값으로 고르는 미리 쓴 설명 (설계 D5). LLM·서버 없음, 숫자는 측정값만 쓴다.

import type { Trial } from "./trial";

export interface Explanation {
  key: string;
  text: string;
}

/** 이론선(박익이론 2πα) 대비 비율. α가 너무 작으면 비교하지 않는다 */
export function theoryRatio(t: Trial): number | null {
  if (t.preset !== "naca0012" || Math.abs(t.alphaDeg) < 1) return null;
  return t.cl / (2 * Math.PI * ((t.alphaDeg * Math.PI) / 180));
}

export function explain(t: Trial): Explanation {
  const a = t.alphaDeg;
  const fmt = (v: number) => v.toFixed(2);
  if (t.preset === "f1-front") {
    if (t.shedding)
      return {
        key: "f1-shedding",
        text: `F1 앞날개가 ${a}°에서 주기적으로 와류를 흘립니다(St ${t.strouhal?.toFixed(2)}). 날개 뒤 흐름이 떨어져 다운포스가 출렁입니다.`,
      };
    if (t.unsteady)
      return { key: "f1-unsteady", text: `${a}°에서 다운포스 계수가 ±${fmt(t.clStd)}만큼 출렁입니다. 흐름이 날개 뒷면에서 떨어지기 시작했습니다.` };
    return {
      key: "f1-steady",
      text: `F1 앞날개는 뒤집힌 날개라 아래로 누르는 힘(다운포스 계수 ${fmt(t.cl)})을 만듭니다. 각도를 키우면 다운포스와 항력(${fmt(t.cd)})이 함께 커집니다.`,
    };
  }
  if (Math.abs(a) < 1)
    return { key: "zero", text: `대칭 날개는 0°에서 위아래 압력이 같아 양력이 거의 0입니다(C_L ${fmt(t.cl)}).` };
  if (a < 0)
    return { key: "negative", text: `받음각이 음수(${a}°)면 날개가 아래로 기울어 양력도 아래 방향(C_L ${fmt(t.cl)})이 됩니다.` };
  if (t.shedding)
    return {
      key: "shedding",
      text: `${a}°에서 날개 뒤로 와류가 번갈아 떨어집니다(St ${t.strouhal?.toFixed(2)}). 교과서의 급격한 실속 대신, 이 낮은 레이놀즈수에서는 이렇게 흐름이 출렁입니다.`,
    };
  if (t.unsteady)
    return { key: "unsteady", text: `${a}°에서 C_L이 ±${fmt(t.clStd)}만큼 출렁입니다. 아직 일정한 주기는 아니지만 흐름이 떨어지기 시작했습니다.` };
  const r = theoryRatio(t);
  if (r !== null && r < 0.9)
    return {
      key: "below-theory",
      text: `C_L ${fmt(t.cl)}은 이론선(2πα)의 ${Math.round(r * 100)}%입니다. 이론선은 점성이 없다고 보는 고레이놀즈수 결과라, 점성이 큰 이 풍동(Re=${t.re})에서는 기울기가 낮게 나옵니다.`,
    };
  return { key: "linear", text: `${a}°에서 C_L ${fmt(t.cl)}. 작은 각도에서는 양력이 각도에 거의 비례해 커집니다.` };
}
