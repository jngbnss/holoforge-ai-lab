import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./Tunnel2D.module.css";
import { GRIDS, type GridSpec, type Live, MIN_STEPS_PER_SEC, Tunnel2D } from "../lbm/tunnel2d";
import { GpuLbm2D } from "../lbm/gpu2d";
import { toCsv } from "../lesson/csv";
import { type Preset, type Trial, completion, upsertTrial } from "../lesson/trial";
import { explain } from "../lesson/tutor";

const STORE_KEY = "holoforge.lab.tunnel2d.v1";
const APP_VERSION = "lab-p6-2";

interface Saved {
  sessionId: string;
  studentId: string;
  prediction: string;
  predictionLocked: boolean;
  explanation: string;
  trials: Trial[];
}

function newSession(): Saved {
  return {
    sessionId: Math.random().toString(36).slice(2, 10),
    studentId: "",
    prediction: "",
    predictionLocked: false,
    explanation: "",
    trials: [],
  };
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...newSession(), ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    /* 저장소를 못 쓰면 새 세션 */
  }
  return newSession();
}

function save(s: Saved): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* 사생활 보호 모드 등: 저장 없이 진행 */
  }
}

type RunState =
  | { kind: "starting" }
  | { kind: "running"; grid: GridSpec; stepsPerSec: number }
  | { kind: "lost" }
  | { kind: "error"; message: string };

const PRESET_LABEL: Record<Preset, string> = { naca0012: "NACA 0012 (대칭 날개)", "f1-front": "F1 앞날개 단면" };

export default function Tunnel2DView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tunnelRef = useRef<Tunnel2D | null>(null);
  const [run, setRun] = useState<RunState>({ kind: "starting" });
  const [live, setLive] = useState<Live | null>(null);
  const [alpha, setAlpha] = useState(4);
  const [preset, setPreset] = useState<Preset>("naca0012");
  const [view, setView] = useState<0 | 1>(0);
  const [saved, setSaved] = useState<Saved>(load);
  const viewRef = useRef(view);
  viewRef.current = view;

  const update = (patch: Partial<Saved>) =>
    setSaved((s) => {
      const next = { ...s, ...patch };
      save(next);
      return next;
    });

  // 시작: 기기 속도를 재고 격자를 고른 뒤 그리기 루프
  useEffect(() => {
    const canvas = canvasRef.current!;
    let raf = 0;
    let stopped = false;
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: false });
    if (!gl) {
      setRun({ kind: "error", message: "WebGL2를 열 수 없습니다." });
      return;
    }
    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      tunnelRef.current = null;
      setRun({ kind: "lost" });
    };
    canvas.addEventListener("webglcontextlost", onLost);
    try {
      let grid = GRIDS.full;
      const probe = new GpuLbm2D(gl, { nx: grid.nx, ny: grid.ny, nu: (grid.u * grid.chord) / grid.re, inflow: () => grid.u, walls: "freeslip", smagorinsky: 0.1 });
      const sps = Tunnel2D.benchmark(probe);
      if (sps < MIN_STEPS_PER_SEC) grid = GRIDS.small;
      const t = new Tunnel2D(gl, grid);
      tunnelRef.current = t;
      const measured = grid === GRIDS.full ? sps : Tunnel2D.benchmark(t.sim);
      t.sim.reset();
      setRun({ kind: "running", grid, stepsPerSec: measured });
      canvas.width = grid.nx * 2;
      canvas.height = grid.ny * 2;
      // 초당 목표 스텝을 프레임에 나눠 돌린다 (60fps 가정, 측정 속도의 70%)
      const perFrame = Math.max(10, Math.round((0.7 * measured) / 60));
      let frame = 0;
      const loop = () => {
        if (stopped || !tunnelRef.current) return;
        t.advance(perFrame);
        t.sim.render(viewRef.current, grid.u);
        if (++frame % 6 === 0) setLive(t.live());
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } catch (e) {
      setRun({ kind: "error", message: (e as Error).message });
    }
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onLost);
    };
  }, []);

  useEffect(() => tunnelRef.current?.setAlpha(alpha), [alpha]);
  useEffect(() => tunnelRef.current?.setPreset(preset), [preset]);

  const grid = run.kind === "running" ? run.grid : null;
  const done = completion(saved.trials, preset);
  const latest = saved.trials.filter((t) => t.preset === preset).at(-1);
  const canRecord = saved.predictionLocked && live?.phase === "ready" && grid !== null;

  const record = () => {
    if (!live || !grid) return;
    const trial: Trial = {
      preset,
      geometryVersion: preset === "naca0012" ? "naca0012-v1" : "f1-front-v1",
      signConvention: preset === "naca0012" ? "lift" : "downforce",
      grid: grid.name,
      re: grid.re,
      alphaDeg: alpha,
      cl: live.cl,
      clStd: live.clStd,
      cd: live.cd,
      unsteady: live.unsteady,
      shedding: live.strouhal !== null && live.unsteady,
      strouhal: live.unsteady ? live.strouhal : null,
    };
    update({ trials: upsertTrial(saved.trials, trial) });
  };

  const download = () => {
    const csv = toCsv({
      studentId: saved.studentId,
      sessionId: saved.sessionId,
      createdAt: new Date().toISOString(),
      prediction: saved.prediction,
      explanation: saved.explanation,
      appVersion: APP_VERSION,
      trials: saved.trials,
    });
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `풍동실험_${saved.studentId || "학번없음"}_${saved.sessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const step = !saved.predictionLocked ? 1 : done.done ? 3 : 2;

  return (
    <div className={styles.layout}>
      <section className={styles.tunnel}>
        <div className={styles.canvasWrap}>
          <canvas ref={canvasRef} className={styles.canvas} data-testid="tunnel2d-canvas" />
          {run.kind === "lost" && (
            <div className={styles.overlay} data-testid="context-lost">
              그래픽이 초기화되었습니다(드라이버 재시작 등). 기록은 저장되어 있습니다. 페이지를 새로 고쳐 다시 시작하세요.
            </div>
          )}
          {run.kind === "error" && <div className={styles.overlay}>시작하지 못했습니다: {run.message}</div>}
          {live?.phase === "unstable" && (
            <div className={styles.overlay} data-testid="unstable">
              계산이 불안정해졌습니다. 이 결과는 기록할 수 없습니다. 각도를 바꾸거나 새로 고쳐 다시 시작하세요.
            </div>
          )}
        </div>
        <div className={styles.toolbar}>
          <span>바람 → </span>
          <button type="button" aria-pressed={view === 0} onClick={() => setView(0)}>
            속도
          </button>
          <button type="button" aria-pressed={view === 1} onClick={() => setView(1)}>
            와도(회전)
          </button>
          <span className={styles.muted}>
            {grid ? `격자 ${grid.name} · Re ${grid.re} · ${Math.round(run.kind === "running" ? run.stepsPerSec : 0)} 스텝/초` : "기기 속도 측정 중…"}
            {grid === GRIDS.small && " · 느린 기기라 간이 격자를 씁니다"}
          </span>
        </div>
        <p className={styles.warn}>⚠ 2D·Re={grid?.re ?? 500} 교육용 근사입니다. 실제 F1 수치가 아닙니다. 12° 이상에서는 풍동 벽(차단율 약 11%) 때문에 값이 다소 높게 나올 수 있습니다.</p>
      </section>

      <aside className={styles.panel}>
        <ol className={styles.steps}>
          <li data-on={step === 1}>1 예측</li>
          <li data-on={step === 2}>2 실험</li>
          <li data-on={step === 3}>3 설명</li>
        </ol>

        <label className={styles.field}>
          예측: 받음각을 두 배로 키우면 양력은 어떻게 될까요?
          <textarea
            value={saved.prediction}
            disabled={saved.predictionLocked}
            onChange={(e) => update({ prediction: e.target.value })}
            rows={2}
            data-testid="prediction"
          />
        </label>
        {!saved.predictionLocked && (
          <button type="button" disabled={!saved.prediction.trim()} onClick={() => update({ predictionLocked: true })} data-testid="lock-prediction">
            예측 확정하고 실험 시작
          </button>
        )}

        <fieldset className={styles.controls} disabled={!saved.predictionLocked}>
          <label>
            형상
            <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              <option value="naca0012">{PRESET_LABEL.naca0012}</option>
              <option value="f1-front" disabled title="F1 단면은 다음 단계(P6-3)에서 추가됩니다">
                {PRESET_LABEL["f1-front"]} (준비 중)
              </option>
            </select>
          </label>
          <label>
            받음각 α = {alpha}°
            <input type="range" min={-5} max={20} step={1} value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} data-testid="alpha" />
          </label>
        </fieldset>

        <div className={styles.readout} data-testid="readout" data-phase={live?.phase ?? "starting"}>
          <div>
            {preset === "f1-front" ? "다운포스 계수" : "양력계수 C_L"}
            <b>{live && Number.isFinite(live.cl) ? live.cl.toFixed(3) : "—"}</b>
          </div>
          <div>
            항력계수 C_D<b>{live && Number.isFinite(live.cd) ? live.cd.toFixed(3) : "—"}</b>
          </div>
          <div>
            상태
            <b>
              {live?.phase === "settling" && `안정화 ${Math.round(live.progress * 100)}%`}
              {live?.phase === "measuring" && "측정 중"}
              {live?.phase === "ready" && (live.unsteady ? (live.strouhal ? "와류 흘림" : "비정상 변동") : "안정")}
              {live?.phase === "unstable" && "불안정"}
              {!live && "준비"}
            </b>
          </div>
        </div>
        <button type="button" disabled={!canRecord} onClick={record} data-testid="record">
          이 각도 기록 (같은 각도는 덮어씀)
        </button>

        <TrialChart trials={saved.trials} preset={preset} />
        {latest && <p className={styles.tutor}>🤖 {explain(latest).text}</p>}
        {!done.done && saved.predictionLocked && <p className={styles.muted}>설명 단계까지 남은 것: {done.missing.join(", ")}</p>}

        <fieldset className={styles.controls} disabled={!done.done}>
          <label className={styles.field}>
            설명: 예측과 결과가 어떻게 달랐고, 왜 그런가요?
            <textarea value={saved.explanation} onChange={(e) => update({ explanation: e.target.value })} rows={3} data-testid="explanation" />
          </label>
          <label>
            학번
            <input value={saved.studentId} onChange={(e) => update({ studentId: e.target.value })} data-testid="student-id" />
          </label>
          <button type="button" onClick={download} disabled={!saved.explanation.trim()} data-testid="download">
            결과 CSV 내려받기 (수업 LMS에 제출)
          </button>
        </fieldset>
        <button
          type="button"
          className={styles.reset}
          onClick={() => {
            if (window.confirm("이 기기에 저장된 예측·기록·설명을 모두 지울까요?")) update(newSession());
          }}
          data-testid="new-session"
        >
          새 세션 (데이터 지우기)
        </button>
        <p className={styles.muted}>값은 학생이 직접 잰 기록입니다. 학번은 이 기기와 내려받은 파일에만 있고, 어디로도 보내지 않습니다.</p>
      </aside>
    </div>
  );
}

function TrialChart({ trials, preset }: { trials: Trial[]; preset: Preset }) {
  const pts = useMemo(() => trials.filter((t) => t.preset === preset), [trials, preset]);
  const W = 280;
  const H = 150;
  const x = (a: number) => ((a + 5) / 25) * (W - 30) + 25;
  const y = (c: number) => H - 15 - ((c + 0.5) / 2.5) * (H - 25);
  const theory = preset === "naca0012";
  return (
    <svg width={W} height={H} className={styles.chart} role="img" aria-label="받음각에 따른 계수 그래프" data-testid="chart">
      <line x1={25} y1={y(0)} x2={W - 5} y2={y(0)} stroke="#30363d" />
      <line x1={x(0)} y1={5} x2={x(0)} y2={H - 15} stroke="#30363d" />
      {theory && <line x1={x(-5)} y1={y(2 * Math.PI * (-5 * Math.PI / 180))} x2={x(20)} y2={y(2 * Math.PI * (20 * Math.PI / 180))} stroke="#8b949e" strokeDasharray="4 3" />}
      {pts.map((t) => (
        <g key={t.alphaDeg}>
          {t.unsteady && <line x1={x(t.alphaDeg)} x2={x(t.alphaDeg)} y1={y(t.cl - t.clStd)} y2={y(t.cl + t.clStd)} stroke="#d29922" />}
          <circle cx={x(t.alphaDeg)} cy={y(t.cl)} r={4} fill={t.unsteady ? "#d29922" : "#58a6ff"} />
        </g>
      ))}
      <text x={W - 5} y={H - 3} fontSize={10} fill="#8b949e" textAnchor="end">
        α(°) →
      </text>
      <text x={28} y={12} fontSize={10} fill="#8b949e">
        {preset === "f1-front" ? "다운포스 계수" : "C_L"} {theory ? "· 점선 = 이론 2πα" : ""}
      </text>
    </svg>
  );
}
