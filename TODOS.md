# TODOS

## 풍동 수업 모듈 (docs/designs/f1-wind-tunnel-lab.md)

### CPU Web Worker 느린 모드
- **What:** float 렌더 타깃(`EXT_color_buffer_float`)이 없는 기기에서 `src/windtunnel/lbm/` CPU 기준 해석기를 Web Worker로 돌리는 느린 모드. 384×128 격자, 배너에 "느린 모드" 표시.
- **Why:** 그런 수업 기기에서는 v1이 "지원하지 않는 기기" 안내만 띄운다. 학생이 실험을 못 한다.
- **Pros:** 모든 기기에서 수업 가능. CPU 기준 구현과 D-4b 작은 격자 검증을 재사용한다.
- **Cons:** human ~3일 / CC ~1~2시간. 시도당 60초 목표라 수업 시간이 빠듯하다.
- **Context:** eng review D2에서 v1에서 뺐다(decision 0a7c491f). 시작점은 lbm/ CPU 해석기를 Worker 메시지 루프로 감싸는 것.
- **Depends on / blocked by:** 첫 교수 미팅에서 수업 기기 중 float 렌더 타깃 미지원 기기가 있다는 보고.

### 실시간 LLM 튜터 (풍동 측정값 도구)
- **What:** backend 튜터에 풍동 측정값(α, C_L, C_D, 비정상 여부) 조회 도구를 추가하고, 수업에서 쓸 백엔드 배포 경로를 정한다.
- **Why:** v1 튜터는 미리 쓴 설명 약 12개뿐이라 학생의 자유 질문에 답하지 못한다.
- **Pros:** 기존 도구 호출 튜터 구조를 재사용한다. HoloForge의 "AI 튜터" 강점을 풍동에도 살린다.
- **Cons:** 백엔드 호스팅과 LLM 비용이 든다. 정적 Pages 링크에서는 동작하지 않는다.
- **Context:** eng review D5에서 v1을 미리 쓴 설명으로 정했다.
- **Depends on / blocked by:** 날짜가 잡힌 첫 수업 확보. 미커밋 `backend/app/ai/tutor.py`(P5-4) 정리.
