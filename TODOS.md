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
- [x] **CI 연결**: `ci.yml` frontend 작업과 `deploy-pages.yml`(빌드 전)에 `npx playwright install --with-deps chromium && npm run e2e` 단계를 넣었다. deploy는 E2E가 실패하면 빌드·배포를 하지 않는다. (eng review D9)
- [x] **DFG 2D-2 벤치마크** (2026-10-12): `npm run bench:dfg -- 2d2 20` → C_L,max 1.077(오차 7.7%), St 0.298(0.5%). 기준 ±10% 통과. C_D,max 3.73(기준 3.24, +15%)은 합격 항목이 아니라 기록만 한다. CPU 60초, 18 MLUPS.

#### 2026-10-12 측정에서 나온 문제: 입구·출구 압력파 반사
- **증상**: 모든 각도(-5°~20°)가 "비정상 변동/와류 흘림"으로 판정된다. 768×256 격자 α=2°에서 C_L 평균 0.12, 표준편차 0.13. CSV의 St가 4~5로 나온다. 실제 와류라면 1 이하여야 한다.
- **원인**: 입구(속도 고정)와 출구(밀도 고정)가 둘 다 압력파를 반사한다. 그래서 채널이 공명관처럼 울린다. 384×128 격자 α=2°에서 C_L이 약 135스텝 주기로 흔들린다. 와류 주기(수천 스텝)보다 훨씬 짧다. 50 c/u를 더 돌려도 표준편차가 0.046에서 0.020으로 천천히 줄 뿐이다. α를 바꿀 때마다 다시 생긴다.
- **시험한 해결책 (CPU 임시 스크립트만)**: 양 끝에 밀도 흡수층을 둔다. 입구 쪽 24셀, 출구 쪽 48셀이고, 매 스텝 `f -= σ(x)·(f_eq(ρ,u) − f_eq(1,u))`를 적용한다. σ는 경계로 갈수록 제곱으로 커져 끝에서 0.1이 된다. 결과: 표준편차 0.046→0.0094(판정 바닥값 0.02 아래), 평균 C_L 0.091→0.090으로 거의 그대로.
- **양력 기울기는 이미 정상**: 768×256 격자 α -5~5°에서 약 0.054/°(3.1/rad, 2π의 약 49%). D-2 ① 기준(30~90%)을 통과하고 문헌(Re=1000에서 π)과도 맞는다.

#### 다음 할 일 (순서대로, 하나 끝날 때마다 커밋·푸시)
1. [ ] **흡수층 구현**: `Lbm2DOptions`에 흡수층 폭 옵션(입구·출구 셀 수, 0이면 끔)을 추가한다. `d2q9.ts` step과 `gpu2d.ts` STEP_FS에 같은 식을 넣는다. `Tunnel2D`는 입구 nx/16, 출구 nx/8로 켜고, DFG 벤치는 끈다. GPU=CPU 비교 E2E(`e2e/lbm2d.spec.ts`)에 흡수층을 켠 경우도 넣는다.
2. [ ] **D-2 진행/중단 판정 재측정**: 실제 GPU에서 α -5~20° 곡선을 다시 그린다. ① 기울기 2π의 30~90%, ② 비정상 판정이 처음 켜지는 각도가 6~14°인지 본다. 흡수층을 넣고도 ②가 실패하면 "사전계산 재생" 대안을 사용자에게 다시 묻는다(eng review D10).
3. [ ] **D-8 안정성 시나리오 재측정**: α -5→20→0° 연속 변경, 시도 전체 길이.
   - 흡수층 없이 잰 결과: 768×256(RTX 4050)은 -5→20→0°에서 발산 없음. 384×128(CPU)은 -5→14°까지 발산 없음(중간에 중단).
   - 흡수층을 넣은 뒤 두 격자 모두 다시 확인한다.
4. [ ] **실제 GPU 확인 마무리**:
   - RTX 4050(Chrome, 헤드리스 + `--force_high_performance_gpu`): 768×256, 1,833~4,732 스텝/초. 시작할 때 0.3초만 재기 때문에 값이 크게 흔들린다.
   - 같은 노트북의 Intel Arc 내장 GPU: 첫 측정이 1,200 미만이라 384×128로 바뀌었다(작은 격자 5,354 스텝/초). D-4 목표 기기(Iris Xe급)에서 768×256이 1,200 스텝/초를 못 넘는다는 뜻이다. 측정 시간을 늘릴지, 문턱값을 바꿀지 정한다.
   - 창이 가려지면 Chrome이 화면 그리기를 멈춰 측정도 멈춘다. 측정은 헤드리스로 한다.
5. [ ] **시도 1회 끝까지 재측정**: 흡수층 없이 잰 결과는 α 2°·8°·14° 기록 → 설명 → CSV까지 38초(각도당 약 12초). 흡수층을 넣은 뒤 다시 재고, CSV의 unsteady·St 값이 그럴듯한지 본다.
6. [ ] **문헌값 확정**: 설계 문서 D-1·D-2에 아래 인용을 적는다. D-2 ② 기준(6~14°)을 이 값으로 다시 맞춘다. Re=500 직접 자료는 아직 못 찾았다.
   - Kurtulus, D. F. (2015). On the Unsteady Behavior of the Flow Around NACA 0012 Airfoil with Steady External Conditions at Re=1000. *Int. J. Micro Air Vehicles* 7(3), 301–326. doi:10.1260/1756-8293.7.3.301
     - Re=1000에서 0° 양력 기울기는 π(2π의 50%), 와류 흘림은 8°에서 시작, 평균 기준 실속은 26°.
   - Liu, Y., Li, K., Zhang, J., Wang, H., Liu, L. (2012). Numerical bifurcation analysis of static stall of airfoil and dynamic stall under unsteady perturbation. *Commun. Nonlinear Sci. Numer. Simul.* 17, 3427–3434. (Re=1000, α<30°)
   - Di Ilio, G. et al. (2018). Fluid flow around NACA 0012 airfoil at low-Reynolds numbers with hybrid lattice Boltzmann method. *Computers & Fluids* (arXiv:2006.10487). LBM으로 Re=1000을 계산했고 와류 시작 약 8°로 나왔다.
7. [ ] **활동지**: `docs/lessons/windtunnel-activity.md`. 채점 기준은 저장소 밖에 둔다(eng review D6). D-2 결과에 맞춰 쓴다.

#### 사람이 해야 하는 일
- 수업에 쓸 실제 노트북으로 `lab.html#/tunnel2d`를 열어 화면 아래 "격자 · 스텝/초" 문구를 기록한다.
- 교수·조교 연락(설계 문서의 성공 지표: 날짜가 잡힌 실제 수업 1건).

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
