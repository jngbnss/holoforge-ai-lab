# HoloForge AI — 설계 및 구현 계획

> 기준 문서: [`spec.md`](spec.md)(원본 명세), [`decision-log.md`](decision-log.md)(확정 결정, spec보다 우선).
> 단계별 상세 지시: [`prompts/phase-1.md`](prompts/phase-1.md) ~ [`prompts/phase-4.md`](prompts/phase-4.md).

## 0. 작업 규칙

모든 작업은 아래 순서를 지킨다.

1. 이 문서 해당 작업 상태를 `진행중`으로 바꾼다 → 커밋 → `git push`.
2. 구현한다(테스트 포함).
3. 해당 작업의 **스모크 테스트**를 실행한다.
4. 통과하면 상태를 `완료`로 바꾸고 결과 한 줄을 비고에 적는다 → 커밋 → `git push`.
5. 실패하면 `진행중` 유지, 비고에 실패 원인을 적고 고친다. 실패한 채로 `완료` 처리하지 않는다.

상태 값: `대기` / `진행중` / `완료` / `보류`

커밋 메시지: `docs: [P1-2] 진행중`, `feat(backend): [P1-2] assembly engine`, `docs: [P1-2] 완료`.

## 1. 전체 설계

### 1.1 처리 흐름

```
[브라우저]
웹캠 ─▶ HandTracker(MediaPipe) ─▶ FeatureExtractor ─▶ RuleClassifier
     ─▶ GestureStateMachine(유지·히스테리시스·쿨다운) ─▶ OneEuroFilter
     ─▶ GestureCommandSource ─┐
       MouseCommandSource ────┼─▶ CommandBus ─▶ 3D Scene(R3F): raycast·드래그 평면·스냅 미리보기
       KeyboardCommandSource ─┘                     │ RELEASE_PART
                                                    ▼
[백엔드 FastAPI]                          POST /sessions/{id}/attempt
  ModelLoader(YAML→Pydantic) ─▶ AssemblyEngine(규칙 판정, 기구 계산) ◀─ Tools ◀─ Tutor loop ◀─ LLMAdapter(Ollama | Mock)
  SQLite(세션 상태, 이벤트 로그)
```

### 1.2 핵심 설계 원칙

| 원칙 | 구현 방법 |
|---|---|
| 제스처와 3D 분리 | 비전 코드는 `Command`(화면 좌표)까지만. 대상 부품·월드 좌표는 3D 계층이 결정 |
| 판정은 규칙 엔진 | `AssemblyEngine`(Python)만 판정. 프론트는 가장 가까운 슬롯 표시만 |
| LLM은 도구로 조회 | 수치는 도구 결과만. 근거 없는 숫자 → `UNGROUNDED_NUMBER` 경고 |
| 교체 가능 | `LLMAdapter`, `CommandSource`, `PartVisual`(절차적 → GLB) 인터페이스 |
| 스키마 검증 | 부품 YAML(Pydantic), 제스처 이벤트·도구 호출(JSON Schema) |
| 프라이버시 | 영상 프레임 저장·전송 금지. 랜드마크만 |
| 정직한 표현 | 게임 물리 ≠ 공학 해석, 홀로그램 유사 ≠ 홀로그램. 화면에 고지 문구 |

### 1.3 디렉토리 설계

```
holoforge-ai-lab/
├─ frontend/                  Vite + React + TS + R3F + Zustand + Vitest
│  └─ src/
│     ├─ features/
│     │  ├─ commands/         Command 타입, CommandBus, Mouse/Keyboard/Gesture 소스
│     │  ├─ camera/           getUserMedia, 권한 처리
│     │  ├─ hand-tracking/    HandTracker, HandFrame, 오버레이
│     │  ├─ gestures/         features, ruleClassifier, stateMachine, filters (순수 TS)
│     │  ├─ assembly/         조립 모드 UI, 슬롯 고스트, 진행률
│     │  ├─ simulation/       작동 모드, 회전 애니메이션
│     │  ├─ ai-tutor/         튜터 패널
│     │  └─ metrics/          지연 계측, 결과 화면
│     ├─ three/               씬, 카메라, parts/(절차적 기어·축·베이스·커버)
│     ├─ services/            api 클라이언트
│     ├─ store/               Zustand
│     └─ types/
├─ backend/                   FastAPI + Pydantic v2 + pytest + Ruff
│  ├─ app/
│  │  ├─ api/                 라우터
│  │  ├─ core/                설정, model_loader, db
│  │  ├─ assembly/            engine, 규칙, 기구 계산
│  │  ├─ gestures/            Python 규칙 분류기(평가용 포팅)
│  │  ├─ tools/               AI 도구 + 레지스트리
│  │  └─ ai/                  LLMAdapter, Ollama, Mock, tutor loop
│  ├─ scripts/                eval_gestures, eval_tool_calls, export_schemas
│  └─ tests/
├─ models/gearbox/            parts.yaml, connections.yaml, assembly-steps.yaml
├─ schemas/                   gesture-event.schema.json, tool-calls.schema.json
├─ datasets/gestures/         raw/ (동의받은 랜드마크 JSONL만)
├─ evals/                     gesture-cases, assembly-cases, tool-call-cases (.jsonl), reports/
├─ docs/
└─ .github/workflows/ci.yml
```

### 1.4 기어박스 모델 (D-001)

| 단계 | 부품 | 비고 |
|---|---|---|
| 1 | `base-plate` | 기준 |
| 2 | `shaft-input`, `shaft-idler`, `shaft-output` | x = 0 / 0.9 / 2.4 |
| 3 | `gear-input-12t`, `gear-idler-24t`, `gear-output-36t` | 모듈 0.05, 각 축이 부모 |
| 4 | `top-cover` | yaw 0°/180° 제약 |

감속비 3:1, 입력·출력 같은 방향, 아이들러 반대 방향.

### 1.5 API

| 메서드 | 경로 | 단계 |
|---|---|---|
| GET | `/api/health` | P1 |
| GET | `/api/models/gearbox` | P1 |
| POST | `/api/sessions` | P1 |
| GET | `/api/sessions/{id}` | P1 |
| POST | `/api/sessions/{id}/attempt` | P1 |
| POST | `/api/sessions/{id}/reset-step` | P1 |
| GET | `/api/sessions/{id}/mechanism?input_rpm=` | P1 |
| GET | `/api/sessions/{id}/events` | P3 |
| POST | `/api/sessions/{id}/tutor` | P4 |

## 2. 단계별 구현 계획

### Phase 1 — 뼈대 + 부품 데이터 + Assembly Engine + 마우스 3D

목표: 웹캠 없이 기어박스가 보이고, 조립 판정 API가 테스트로 검증됨.

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 | 비고 |
|---|---|---|---|---|---|
| P1-1 | 모노레포 뼈대 | frontend/, backend/, README, LICENSE, .gitignore, .env.example | `npm run build` 성공, `uvicorn` 기동 후 `GET /api/health` = 200 | 완료 | health 200, pytest 1 passed, vite build OK |
| P1-2 | 부품 YAML + 로더 | models/gearbox/*.yaml, model_loader.py | 로더 테스트 통과, 참조 무결성·기어 중심 거리 검사 통과 | 완료 | pytest 10 passed, GET /api/models/gearbox 8부품·8슬롯·4단계 |
| P1-3 | Assembly Engine | engine.py, assembly-cases.jsonl | 오류 8종 + 전체 조립 + 기구 상태(출력 rpm = 입력/3) pytest 통과 | 완료 | pytest 37 passed (케이스 16개, 오류 8종 전부, 출력 rpm 10 @ 입력 30) |
| P1-4 | 세션 API + SQLite | api/, db.py | TestClient로 세션 생성 → 전체 조립 → mechanism 응답 확인 | 완료 | pytest 42 passed, 실서버 curl로 8부품 조립 → 입력 30rpm 시 출력 10rpm 확인 |
| P1-5 | 3D 씬 + Command 계층 | three/parts/, features/commands/ | 브라우저에서 8부품 표시, 마우스 드래그 회전, Vitest(CommandBus) 통과 | 완료 | Chrome headless: 8부품 렌더, 오른쪽 드래그 회전, 클릭 선택(커버 뒤 기어 우선), 콘솔 에러 0, vitest 6 passed |
| P1-6 | CI + 기본 문서 | ci.yml, architecture.md, licenses.md, simulation-limitations.md | 로컬에서 ruff·pytest·tsc·vitest·build 전부 통과 | 완료 | 로컬 CI 단계 전부 통과 + GitHub Actions success |

### Phase 2 — 손 추적 + 제스처 + 안정화 + 녹화

목표: 웹캠으로 부품을 집어 옮기고, 펼친 손으로 모델 회전.

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 | 비고 |
|---|---|---|---|---|---|
| P2-1 | 카메라 | features/camera/ | 권한 허용 시 미리보기, 거부 시 에러 UI | 완료 | Chrome 가짜 카메라: 허용 시 640px 미리보기(거울), 거부 시 권한 안내, vitest 15 passed |
| P2-2 | HandTracker | features/hand-tracking/ | 손 올리면 랜드마크 오버레이 + fps ≥ 24 표시 | 완료 | MediaPipe 샘플 손 사진(y4m 가짜 카메라)으로 손 감지 95%·오버레이 정확, GPU headless 추적 32fps, vitest 21 passed |
| P2-3 | 분류기 + 상태 머신 + 필터 | features/gestures/, gesture-cases.jsonl, Python 포팅 | Vitest·pytest 동일 케이스 통과, HUD에 제스처 표시 | 완료 | 가상 손 4포즈 HUD 정확, 실제 손 사진→손바닥 펼치기, TS·Python 동일 33케이스(vitest 68, pytest 77) |
| P2-4 | GestureCommandSource + 3D 연결 | 드래그 평면, 손 커서 | 집기로 부품 이동, 펼친 손 회전, 주먹 취소 수동 확인 | 완료 | 가상 손: 펼친 손 이동→yaw -0.40→0.79, 집기로 부품 이동, 손 치우면 놓기, 주먹→원위치 복원, 콘솔 에러 0, vitest 74 |
| P2-5 | 녹화 화면 + 지연 계측 | /record, metrics/ | 2초 녹화 → JSONL 다운로드, HUD p50/p95 표시 | 완료 | 손 사진 영상 2초 녹화→JSONL 56프레임·29fps·이미지 없음, 지연 p95 랜드마크 31ms·프레임→명령 37ms, vitest 80 |
| P2-6 | 이벤트 스키마 + 문서 | schemas/gesture-event.schema.json, gesture-spec.md | 프론트·백엔드 스키마 검증 테스트 통과 | 완료 | Ajv(vitest 85)·jsonschema(pytest 80)로 파이프라인 이벤트·녹화 샘플 검증, 이미지 필드 거부 확인, build OK |

### Phase 3 — 분해·조립·작동 모드

목표: 조립 성공·실패가 화면에 나오고, 작동 모드에서 기어 방향·속도가 맞음.

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 | 비고 |
|---|---|---|---|---|---|
| P3-1 | 모드 상태 + 탭 | store, SET_MODE | 탭·단축키로 6개 모드 전환 | 완료 | 키 1~7·탭 클릭·직접 URL로 7개 모드 전환, 해시 동기화, 콘솔 에러 0, vitest 87 |
| P3-2 | 분해 모드 | explode 애니메이션, 부품 목록 | E키로 분해, 목록 클릭 시 포커스 | 완료 | 키 2로 분해도 진입·화면 맞춤, 목록 클릭→아이들러 기어 포커스·설명, E 토글, /api 차단 시 정적 모델로 보기 전용, 콘솔 에러 0 |
| P3-3 | 조립 모드 | 슬롯 고스트, attempt 연동, 오류 토스트, 진행률 | 올바른 슬롯 스냅, 잘못된 슬롯/순서/방향 오류 표시 | 완료 | 마우스로 8부품 전체 조립 성공(10.4초), MISSING_PARENT·WRONG_ORIENTATION(기대 0°/현재 90°)·WRONG_SLOT 토스트, 가상 손 집기로 결합 성공, R/A 동작, 콘솔 에러 0 |
| P3-4 | 작동 모드 | rpm 슬라이더, 방향 화살표 | 아이들러 반대 방향, 출력 1/3 속도 | 완료 | 자동 조립 후 입력 30rpm→아이들러 -15(시계)·출력 10rpm(반시계), 감속비 3:1, -30rpm 방향 반전, 미조립 시 사유 6개 표시, 콘솔 에러 0, vitest 97 |
| P3-5 | 이벤트 로그 + 테스트 | events API, assembly-cases 10+ | API 통합 테스트 통과 | 완료 | 실서버 조립 시나리오→events 14건, 요약 시도 11·성공 8·오류 3종·리셋 1·완료 9.94초, pytest 82 |

### Phase 4 — AI 튜터 + 평가 + 결과 화면

목표: AI가 도구로 실제 상태를 조회해 설명하고, 평가 리포트가 생성됨.

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 | 비고 |
|---|---|---|---|---|---|
| P4-1 | LLMAdapter (Mock/Ollama) | app/ai/ | Mock으로 응답, Ollama 없으면 degraded 폴백 | 완료 | 실제 qwen3:8b가 get_part_info(gear-input-12t) 호출(4.8초), 잘못된 주소→Mock 폴백·degraded, pytest 98 |
| P4-2 | 도구 6개 + 스키마 | app/tools/, tool-calls.schema.json | 도구 단위 테스트, 스키마 내보내기 | 완료 | 실서버 세션에 도구 6개 실행: 상태 8/8·오류 없음·36T 정보·감속비 3·시뮬레이션 action, 잘못된 part_id는 error 반환, pytest 107 |
| P4-3 | 튜터 루프 + API | /tutor | "작은 기어 역할?" → get_part_info 호출 후 답변 | 완료 | 실제 qwen3:8b: 작은 기어 역할→get_part_info, 반대 회전→get_mechanism_state(30), 잘못 끼움→get_assembly_error(90°→0°), 경고 0, pytest 115 |
| P4-4 | 튜터 화면 | features/ai-tutor/ | 질문 → 답변 + 도구 내역 표시, "왜 틀렸어?" 버튼 | 완료 | 실제 qwen3: 조립 오류→왜 틀렸어?→90°→0° 설명, 3D 선택 부품 질문, 60rpm 돌려 봐→작동 모드 60rpm 전환, scrollIntoView Promise 크래시 수정, 콘솔 에러 0 |
| P4-5 | 평가 스크립트 | eval_gestures.py, eval_tool_calls.py, reports/ | 두 스크립트 실행 → 리포트 생성 | 완료 | eval_gestures(합성 36클립·사진 녹화 1클립) 리포트 생성, eval_tool_calls mock 100%·qwen3 기준 75%→도구 강제 후 94%(인자 50→83%, 미근거 19→0%), pytest 116 |
| P4-6 | 결과 화면 + 문서 | /results, experiments.md, model-selection.md | 결과 화면에 지연·조립 통계 표시, README 완료 조건 표 | 완료 | 결과 화면: 지연 p50/p95·세션(시도 2·오류 MISSING_PARENT 1)·제스처 평가·도구 호출 개선 전후 표시, JSON 내보내기, pytest 117·vitest 100·build OK |

### Phase 5 — MVP 이후 개선 (README 로드맵)

목표: 실제 LLM 데모 품질(요청 인식·첫 응답 지연) 개선.

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 | 비고 |
|---|---|---|---|---|---|
| P5-1 | 시뮬레이션 요청 인식 (E-01 잔여) | 도구 설명·프롬프트 보강, experiments.md E-01 재측정 | qwen3:8b로 `eval_tool_calls.py --provider ollama` → `simulate` 케이스 통과 | 완료 | qwen3:8b: simulate→run_visual_simulation(45), 선택 94→100%·인자 83→100%·미근거 0%(시뮬레이션 결과에 rpm 추가), pytest 120 |
| P5-2 | LLM 워밍업 + keep_alive | 서버 시작 시 모델 예열, `OLLAMA_KEEP_ALIVE` | 서버 기동 직후 첫 튜터 질문 지연 측정(개선 전후) | 완료 | 예열 6.8~7.1s(백그라운드, 기동 0.5s 유지), 첫 질문 평균 25.5→20.8s(2회), keep_alive 30m, pytest 120 |
| P5-3 | 프론트 번들 분할 | vite manualChunks / 모드별 lazy | `npm run build` 500kB 경고 없음, 스모크(모드 전환) | 완료 | 단일 1371kB → 앱 75·react 221·r3f 183·three 737kB(단일 라이브러리, 경고 기준 800kB), MediaPipe 154kB는 카메라 켤 때만 로드, 7개 모드 전환·콘솔 에러 0, vitest 100 |
| P5-4 | 진행 질문 답에 부품 수 | 진행 상황 답변 규칙·도구 출력 보강 | qwen3:8b `progress-complete` 사실 일치 | 진행중 | |
| P5-5 | Rapier 오류 낙하 연출 | 잘못 놓은 부품 낙하 후 작업대 복귀 | 오류 시 낙하 연출, 콘솔 에러 0, vitest | 완료 | 축을 베이스보다 먼저 놓음→MISSING_PARENT 후 튀어 올라 떨어진 뒤 작업대 복귀(1.2초), Rapier 203kB+wasm 2MB는 조립 모드 진입 시 로드, 빌드 경고 없음, 콘솔 에러 0, vitest 103 |
| P5-6 | 손목 회전으로 부품 회전 | 손바닥 법선/손목 각도 → ROTATE_PART | 가상 손 회전 포즈로 부품 yaw 변경, vitest | 완료 | 가상 손 집기 후 0.8rad(46°) 기울임→출력 기어 yaw 0→-90°(15°×6), 되돌리면 -60°, 떨림 ±3° 무반응·±180° 경계 테스트, 콘솔 에러 0, vitest 110 |
| P5-7 | 양손 제스처 | numHands 2, 양손 거리 → 분해/조립 | 가상 양손 벌리기/모으기로 분해 토글, vitest | 완료 | 분해 모드 가상 양손: 모으기→ASSEMBLE_ALL(접힘)·벌리기→EXPLODE(분해), 그동안 모델 yaw 불변, 한 손 집기·손목 회전 회귀 없음, 콘솔 에러 0, vitest 119 |
| P5-8 | 학습 분류기 비교 | train_classifier.py (RandomForest, LOSO) | 합성 데이터로 실행·비교표, 실제 데이터 없으면 명시 | 완료 | 합성 1,056프레임·피험자 3명 LOSO: 규칙 100%·RF 99.9%(합성이라 비교 무의미, E-05에 명시), sklearn은 ml 그룹(없으면 건너뜀), pytest 123+1 skip |
| P5-9 | GLB 에셋 로더 | PartVisual GLB 교체 구조, 파일 없으면 절차적 폴백 | GLB 있으면 로드·없으면 기존 형상, 콘솔 에러 0 | 완료 | 스모크 GLB(육각 축)로 shaft-input 교체·잡기 정상, 없는 파일 가리킨 shaft-idler는 경고 1회 후 원기둥, 빈 목록이면 기존과 동일, 콘솔 에러 0, vitest 121 |
| P5-10 | 실제 사람 제스처 데이터 | datasets/gestures/raw/ | 7명 × 4라벨 × 조명 3 녹화 | 보류 | 사람 녹화 필요(코드로 대체 불가) |
| P5-11 | CalculiX / OpenFOAM | 별도 프로세스 연동 | - | 보류 | MVP 범위 밖(spec §14) |

### Phase 6 — 브라우저 공학 실험실 (CAD·풍동·응력·진동·열)

설계: [`designs/f1-wind-tunnel-lab.md`](designs/f1-wind-tunnel-lab.md). 2026-10-12 사용자 결정으로 범위를 전체 기능으로 넓혔다(2D 풍동만 하던 v1 결정을 대체). 별도 페이지 `frontend/lab.html`, 코드 `frontend/src/lab/`. 모든 해석은 브라우저 안에서 돌고, 복셀 격자 하나를 바람·힘·떨림·열 계산에 함께 쓴다. 교육용 근사이며 실제 설계 판단에 쓸 수 없다.

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 | 비고 |
|---|---|---|---|---|---|
| P6-1 | 실험실 페이지 뼈대 | lab.html, Vite 다중 입력, 탭 6개, 기기 검사(WebGL2·float·WebGPU), 기어박스 앱 링크 | build 통과, 브라우저에서 탭 전환·기기 검사 표시, 기어박스 앱 회귀 없음 | 진행중 | |
| P6-2 | 2D 풍동 | D2Q9 LBM(CPU 기준 + WebGL2), NACA0012, 받음각, C_L/C_D, 수렴 판정, 기록·CSV | CPU DFG 2D-1 C_D ±10%, GPU↔CPU 일치, 브라우저 흐름 표시 | 대기 | |
| P6-3 | 복셀 코어 + F1 불러오기 | GLB(meshopt) 로드, 표면 복셀화 + 외부 채우기로 닫힌 부피, 3D 복셀 보기 | F1 복셀화 결과 닫힌 부피, vitest | 대기 | |
| P6-4 | 응력 | 복셀 hex8 선형탄성 FEA, PCG, 고정면·하중, von Mises 색 | 외팔보 끝 처짐 vs 이론 ±10% | 대기 | |
| P6-5 | 진동 | 고유진동(부분공간 반복), 모드 1~3 애니메이션 | 외팔보 1차 고유진동수 vs 이론 ±10% | 대기 | |
| P6-6 | 열 | 과도 열전도(대류 경계), 브레이크 디스크 프리셋 | 1D 평판 해석해 비교 | 대기 | |
| P6-7 | CAD | 매개변수 부품(날개·브래킷·디스크) manifold-3d 불리언, STL 내보내기, 해석 탭으로 보내기 | 부품 생성→복셀→응력 해석 연결 | 대기 | |
| P6-8 | 3D 풍동 | WebGPU D3Q19, F1·CAD 부품, 단면 보기, 항력 | 구 Re=100 C_D 문헌값 ±15% | 대기 | |

## 3. 완료 조건 추적 (spec §22)

| # | 시나리오 | 단계 | 상태 |
|---|---|---|---|
| 1 | 카메라 권한 허용 | P2-1 | 완료 |
| 2 | 손 감지 | P2-2 | 완료 |
| 3 | 현재 제스처 표시 | P2-3 | 완료 |
| 4 | 집기로 부품 선택 | P2-4 | 완료 |
| 5 | 손 이동으로 부품 이동 | P2-4 | 완료 |
| 6 | 손 움직임으로 모델 회전 | P2-4 | 완료 |
| 7 | 올바른 위치에서 조립 | P3-3 | 완료 |
| 8 | 잘못된 위치에서 오류 표시 | P3-3 | 완료 |
| 9 | AI에게 부품 역할 질문 | P4-4 | 완료 |
| 10 | AI가 실제 데이터 조회 후 설명 | P4-3 | 완료 |
| 11 | 작동 모드 회전 방향 확인 | P3-4 | 완료 |
| 12 | 평가 스크립트로 정확도·지연 측정 | P4-5 | 완료 |

## 4. 위험과 대응

| 위험 | 대응 | 확인 시점 |
|---|---|---|
| 제스처 오인식·떨림 | 손 크기 정규화, 히스테리시스, 유지 프레임, One Euro, 마우스 폴백 | P2-3 |
| 2D 손 → 3D 배치 | 드래그 평면, 넓은 스냅 반경, 슬롯 고스트 | P2-4, P3-3 |
| 로컬 LLM 품질·속도 | think=false, 도구 최소화, Mock 백업, 숫자 근거 검사 | P4-3 |
| 브라우저 성능 | 640×480, 그림자 최소, 필요 시 Worker | P2-2 |
| 에셋 제작 시간 | 절차적 지오메트리 | P1-5 |
