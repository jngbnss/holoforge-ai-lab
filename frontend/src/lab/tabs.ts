// 공학 실험실 탭. 해시(#/stress 등)가 단일 진실 원천이다 (기어박스 앱 modes.ts와 같은 방식).

/** 탭이 돌아가려면 필요한 브라우저 기능 */
export type Requirement = "none" | "webgl2-float" | "webgpu";

export type LabTab = "cad" | "tunnel2d" | "tunnel3d" | "stress" | "vibration" | "heat";

export interface LabTabInfo {
  id: LabTab;
  label: string;
  /** 한 줄 설명 (탭 첫 화면) */
  summary: string;
  requires: Requirement;
}

export const LAB_TABS: LabTabInfo[] = [
  { id: "cad", label: "CAD", summary: "날개·브래킷·디스크를 치수로 만들고 해석 탭으로 보낸다.", requires: "none" },
  {
    id: "tunnel2d",
    label: "2D 풍동",
    summary: "날개 단면에 바람을 불어 받음각에 따른 양력·항력을 잰다.",
    requires: "webgl2-float",
  },
  {
    id: "tunnel3d",
    label: "3D 풍동",
    summary: "F1 차나 CAD 부품 주위 흐름과 항력을 본다.",
    requires: "webgpu",
  },
  { id: "stress", label: "응력", summary: "고정하고 힘을 주면 어디가 얼마나 휘고 응력이 몰리는지 본다.", requires: "none" },
  { id: "vibration", label: "진동", summary: "부품의 고유진동수와 흔들리는 모양(모드)을 본다.", requires: "none" },
  { id: "heat", label: "열", summary: "가열한 부품이 식는 동안 온도 분포가 어떻게 바뀌는지 본다.", requires: "none" },
];

const IDS = new Set<string>(LAB_TABS.map((t) => t.id));

export function parseLabTab(hash: string): LabTab {
  const id = hash.replace(/^#\/?/, "");
  return IDS.has(id) ? (id as LabTab) : "cad";
}

export function labTabHash(tab: LabTab): string {
  return `#/${tab}`;
}
