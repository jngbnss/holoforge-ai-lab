// 제출용 CSV. 학생 입력은 스프레드시트 수식으로 실행되지 않게 막는다.

import type { Trial } from "./trial";

export interface Submission {
  studentId: string;
  sessionId: string;
  createdAt: string;
  prediction: string;
  explanation: string;
  appVersion: string;
  trials: Trial[];
}

/** =,+,-,@,탭,CR로 시작하면 앞에 작은따옴표를 붙여 수식 실행을 막고, CSV 규칙대로 따옴표로 감싼다 */
export function csvCell(v: string | number | boolean | null): string {
  let s = v === null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 실수로 고친 것 감지용 짧은 해시(FNV-1a). 위조 방지용이 아니다: 값은 학생 자기 보고다 */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const TRIAL_COLS = [
  "preset",
  "geometry_version",
  "sign_convention",
  "grid",
  "re",
  "alpha_deg",
  "cl",
  "cl_std",
  "cd",
  "unsteady",
  "shedding",
  "strouhal",
] as const;

export function toCsv(s: Submission): string {
  const head: [string, string | number][] = [
    ["student_id", s.studentId],
    ["session_id", s.sessionId],
    ["created_at", s.createdAt],
    ["app_version", s.appVersion],
    ["prediction", s.prediction],
    ["explanation", s.explanation],
  ];
  const lines = head.map(([k, v]) => `${k},${csvCell(v)}`);
  lines.push("");
  lines.push(TRIAL_COLS.join(","));
  for (const t of s.trials) {
    lines.push(
      [
        t.preset,
        t.geometryVersion,
        t.signConvention,
        t.grid,
        t.re,
        t.alphaDeg,
        t.cl.toFixed(4),
        t.clStd.toFixed(4),
        t.cd.toFixed(4),
        t.unsteady,
        t.shedding,
        t.strouhal === null ? null : t.strouhal.toFixed(3),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const body = lines.join("\n");
  return `${body}\ncheck,${fnv1a(body)}\n`;
}
