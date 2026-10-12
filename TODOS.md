# TODOS

## 공학 실험실 Phase 6 남은 작업 (2026-10-12 기준)

실행 순서대로 정리했다. 상태 표는 [docs/implementation-plan.md](docs/implementation-plan.md) Phase 6, 설계는 [docs/designs/f1-wind-tunnel-lab.md](docs/designs/f1-wind-tunnel-lab.md).
코드 위치: `frontend/lab.html`, `frontend/src/lab/`. 테스트: `npm test`(노드), `npm run e2e`(Playwright, 브라우저 GPU), `npm run bench:dfg`(물리 검증).

### 완료
- [x] **P6-1 실험실 페이지 뼈대**: lab.html, 탭 6개, 기기 검사, 기어박스 앱 링크
- [x] **P6-2 (일부)**:
  - D2Q9 CPU 해석기(`lbm/d2q9.ts`)와 WebGL2 해석기(`lbm/gpu2d.ts`). GPU=CPU 오차 2e-7.
  - 경계 처리: 입구·출구 평형 경계, 위아래 free-slip 또는 no-slip, 물체 bounce-back.
  - 검증: DFG 2D-1 C_D 5.90(정답 5.58, 오차 5.8%). Re=500, α=4°에서 C_L 0.18(이론선의 41%).
  - 수업 로직(`lesson/`): 수렴 판정, 비정상·와류 흘림 판정, 완료 조건, CSV(수식 주입 방지·확인 해시), 미리 쓴 튜터 설명.
  - 2D 풍동 화면: 예측 → 실험 → 설명, 속도·와도 보기, 자동 격자 전환, 컨텍스트 손실·불안정 안내, 새 세션.
  - Playwright E2E 7개. vitest 136개.

### P6-2 마무리 (2D 풍동)
- [ ] **CI 연결**: `.github/workflows/ci.yml` frontend 작업에 `npx playwright install --with-deps chromium && npm run e2e`를 추가하고, `deploy-pages.yml`에도 같은 단계를 넣어 실패하면 배포를 막는다. (eng review D9)
- [ ] **실제 GPU 확인**: RTX 4050 Chrome에서 lab.html을 열어 스텝/초를 재고 768×256 격자로 도는지 본다. SwiftShader는 37~85 스텝/초라 자동으로 작은 격자로 바뀐다.
- [ ] **시도 1회 끝까지 돌려 보기**: α 2°·8°·14° 기록 → 설명 → CSV 내려받기. 시도 길이는 정착 8 c/u + 측정 창 2 × 6 c/u이고, 와류 주기를 잡으려고 원래 설계의 4 c/u보다 늘렸다. 실제 걸리는 시간을 잰다.
- [ ] **D-2 진행/중단 판정**: α -5~20° 곡선을 그려 기울기가 2π의 30~90%(현재 41%)인지, 와류 흘림 시작이 6~14°인지 확인한다. 실패하면 "사전계산 재생" 대안을 다시 묻는다(eng review D10).
- [ ] **D-8 안정성 시나리오**: NACA로 α -5→20→0° 연속 변경 × 시도 전체 길이에서 발산이 없는지. 작은 격자(Re=500, τ≈0.524)도 따로 본다.
- [ ] **DFG 2D-2 벤치마크**: `npm run bench:dfg -- 2d2 20` → C_L,max ≈ 1.0, St ≈ 0.30, 오차 ±10%.
- [ ] **문헌값 확정**: 저레이놀즈수 NACA0012(Kurtulus 2015 등)의 기울기·와류 시작 각도를 전체 인용과 함께 설계 문서 D-1에 적는다.
- [ ] **활동지**: `docs/lessons/windtunnel-activity.md`. 채점 기준은 저장소 밖에 둔다(eng review D6).

### P6-3 복셀 코어 + F1 불러오기
- [ ] `f1-2026.glb`(jngbnss/f1, CC-BY-4.0)를 `frontend/public/lab/`에 넣고 출처를 `docs/licenses.md`에 적는다. 수정 사항("부위 분리·단면 추출·복셀화")도 함께 적는다.
- [ ] GLB 로드(three GLTFLoader + MeshoptDecoder).
- [ ] 표면 복셀화 + 바깥에서 채우기(flood fill)로 닫힌 부피를 만든다. 원본은 비수밀이고 차체만 조각 13,854개다.
- [ ] 3D 복셀 보기.
- [ ] F1 앞날개 2D 단면 추출 스크립트: 평면 절단 → 시위 0.5% 허용오차로 선분 잇기 → 닫힘·자기교차·두께(c=80에서 2셀) 검사 → 실패하면 손으로 그린 단면. 2D 풍동의 "F1 앞날개 단면" 프리셋을 켠다(지금은 "준비 중"으로 비활성).

### P6-4 응력
- [ ] 복셀 hex8 선형탄성 FEA + PCG 해석기(Web Worker).
- [ ] 고정면·하중 지정 UI, 변형 형상, von Mises 색.
- [ ] 검증: 외팔보 끝 처짐을 이론 PL³/3EI와 비교, ±10%.

### P6-5 진동
- [ ] 질량행렬 + 부분공간 반복(또는 shift-invert Lanczos)으로 고유모드 1~3.
- [ ] 모드 애니메이션.
- [ ] 검증: 외팔보 1차 고유진동수 이론값(1.875²·√(EI/ρAL⁴)/2π)과 비교, ±10%.

### P6-6 열
- [ ] 과도 열전도(암시적 시간적분), 대류 경계, 브레이크 디스크 프리셋, 냉각 곡선.
- [ ] 검증: 1D 평판 해석해.

### P6-7 CAD
- [ ] manifold-3d로 매개변수 부품을 만든다(날개 NACA 돌출, 구멍 뚫린 브래킷, 통풍 디스크).
- [ ] 치수 슬라이더, STL 내보내기.
- [ ] "응력·진동·열·3D 풍동으로 보내기"(복셀화 연결).

### P6-8 3D 풍동
- [ ] WebGPU D3Q19 해석기. CPU 기준 구현과 비교한다.
- [ ] F1 차·CAD 부품을 넣고 단면 보기와 항력을 본다.
- [ ] 검증: 구 Re=100 C_D 문헌값 ±15%.
- [ ] 헤드리스 SwiftShader에는 WebGPU가 없다. 실제 GPU 브라우저 확인 방법을 정한다.

### 정리할 것
- [ ] 미커밋 `backend/app/ai/tutor.py`(P5-4 진행 질문 답에 부품 수) 측정 후 커밋 또는 되돌리기.
- [ ] Windows에서 `TaskStop`으로 `npx tsx`를 멈춰도 자식 node 프로세스가 남는다. 긴 벤치마크는 `timeout`으로 감싸 실행한다.

## 미룬 것 (조건 충족 시 다시 열기)

### CPU Web Worker 느린 모드
- **What:** float 렌더 타깃(`EXT_color_buffer_float`)이 없는 기기에서 `src/lab/lbm/d2q9.ts` CPU 해석기를 Web Worker로 돌리는 느린 모드. 384×128 격자, 배너에 "느린 모드" 표시.
- **Why:** 그런 수업 기기에서는 지금 "지원하지 않는 기기" 안내만 띄운다. 학생이 실험을 못 한다.
- **Pros:** 모든 기기에서 수업 가능. CPU 해석기와 D-4b 작은 격자 검증을 재사용한다.
- **Cons:** human ~3일 / CC ~1~2시간. CPU 속도는 약 23 MLUPS라 시도당 1분 안팎이 걸린다.
- **Context:** eng review D2에서 v1에서 뺐다(decision 0a7c491f).
- **Depends on / blocked by:** 첫 교수 미팅에서 수업 기기 중 float 렌더 타깃 미지원 기기가 있다는 보고.

### 실시간 LLM 튜터 (풍동 측정값 도구)
- **What:** backend 튜터에 풍동 측정값(α, C_L, C_D, 비정상 여부) 조회 도구를 추가하고, 수업에서 쓸 백엔드 배포 경로를 정한다.
- **Why:** v1 튜터는 미리 쓴 설명뿐이라 학생의 자유 질문에 답하지 못한다.
- **Pros:** 기존 도구 호출 튜터 구조를 재사용한다.
- **Cons:** 백엔드 호스팅과 LLM 비용이 든다. 정적 Pages 링크에서는 동작하지 않는다.
- **Context:** eng review D5에서 v1을 미리 쓴 설명으로 정했다.
- **Depends on / blocked by:** 날짜가 잡힌 첫 수업 확보. 미커밋 `backend/app/ai/tutor.py`(P5-4) 정리.
