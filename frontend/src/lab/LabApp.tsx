import { type ReactNode, useEffect, useState } from "react";
import styles from "./Lab.module.css";
import { type DeviceCaps, probeDevice, tabSupport } from "./core/device";
import { LAB_TABS, type LabTab, labTabHash, parseLabTab } from "./tabs";

function useLabTab(): LabTab {
  const [tab, setTab] = useState<LabTab>(() => parseLabTab(window.location.hash));
  useEffect(() => {
    const onHash = () => setTab(parseLabTab(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return tab;
}

/** 탭별 화면. 아직 구현 전인 탭은 설명만 보여 준다. */
const TAB_VIEWS: Partial<Record<LabTab, () => ReactNode>> = {};

function TabBody({ tab, caps }: { tab: LabTab; caps: DeviceCaps | null }) {
  const info = LAB_TABS.find((t) => t.id === tab)!;
  if (!caps) return <div className={styles.notice}>기기 기능을 확인하는 중…</div>;
  const support = tabSupport(info.requires, caps);
  if (!support.ok) {
    return (
      <div className={styles.notice} data-testid="unsupported">
        <strong>지원하지 않는 기기</strong>
        <p>{support.reason}</p>
        <p className={styles.muted}>다른 탭(응력·진동·열·CAD)은 이 기기에서도 쓸 수 있습니다.</p>
      </div>
    );
  }
  const View = TAB_VIEWS[tab];
  if (View) return <View />;
  return (
    <div className={styles.notice} data-testid="tab-placeholder">
      <strong>{info.label}</strong>
      <p>{info.summary}</p>
      <p className={styles.muted}>준비 중입니다.</p>
    </div>
  );
}

export default function LabApp() {
  const tab = useLabTab();
  const [caps, setCaps] = useState<DeviceCaps | null>(null);
  useEffect(() => {
    void probeDevice().then(setCaps);
  }, []);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1>공학 실험실</h1>
        <nav className={styles.nav} aria-label="실험">
          {LAB_TABS.map((t) => {
            const blocked = caps !== null && !tabSupport(t.requires, caps).ok;
            return (
              <a
                key={t.id}
                href={labTabHash(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                data-blocked={blocked || undefined}
                title={t.summary}
              >
                {t.label}
              </a>
            );
          })}
        </nav>
        <a className={styles.back} href="./">
          기어박스 실습으로
        </a>
      </header>
      <main className={styles.stage} data-testid="lab-stage" data-tab={tab}>
        <TabBody tab={tab} caps={caps} />
      </main>
      <footer className={styles.footer} data-testid="device-line">
        {caps
          ? `WebGL2 ${caps.webgl2 ? "○" : "×"} · float 텍스처 ${caps.floatRenderTarget ? "○" : "×"} · WebGPU ${caps.webgpu ? "○" : "×"}${caps.gpuName ? ` · ${caps.gpuName}` : ""}`
          : "기기 확인 중"}
        <span> · 교육용 근사 계산입니다. 실제 설계·제조·안전 판단에 쓸 수 없습니다.</span>
      </footer>
    </div>
  );
}
