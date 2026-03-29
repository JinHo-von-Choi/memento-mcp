# Internals

## MemoryEvaluator

서버가 시작되면 MemoryEvaluator 워커가 백그라운드에서 구동된다. `getMemoryEvaluator().start()`로 시작되는 싱글턴이다. SIGTERM/SIGINT 수신 시 graceful shutdown 흐름에서 중지된다.

워커는 5초 간격으로 Redis 큐 `memory_evaluation`을 폴링한다. 큐가 비어 있으면 대기한다. 큐에서 잡(job)을 꺼내면 Gemini CLI(`geminiCLIJson`)를 호출하여 파편 내용의 합리성을 평가한다. 평가 결과는 fragments 테이블의 utility_score와 verified_at을 갱신하는 데 사용된다.

새 파편이 remember로 저장될 때 평가 큐에 자동으로 투입된다. 평가는 저장과 비동기로 분리되어 있으므로 remember 호출의 응답 시간에 영향을 주지 않는다.

Gemini CLI가 설치되지 않은 환경에서는 워커가 구동되지만 평가 작업을 건너뛴다.

---

## MemoryConsolidator

파편 저장 흐름: `remember()` 호출 시 ConflictResolver의 `autoLinkOnRemember`가 동일 topic 파편과 `related` 링크를 즉시 생성한다. 이후 `embedding_ready` 이벤트가 발행되면 GraphLinker가 semantic 유사도 기반 링크를 추가한다. MemoryConsolidator는 이 링크 망을 유지보수하는 별도의 주기적 파이프라인이다.

memory_consolidate 도구가 실행되거나 서버 내부 스케줄러(6시간 간격, CONSOLIDATE_INTERVAL_MS로 조정)가 트리거할 때 동작하는 18단계 유지보수 파이프라인이다.

1. **TTL 계층 전환**: hot → warm → cold 강등. 접근 빈도와 경과 시간 기준. warm → permanent 승격은 importance≥0.8이고 `quality_verified IS DISTINCT FROM FALSE`인 파편만 대상 — Circuit Breaker 패턴으로 평가가 명시적으로 부정(FALSE)된 파편의 permanent 등급 진입을 차단한다(TRUE=정상, NULL+is_anchor=앵커 폴백, NULL+importance≥0.9=오프라인 폴백). permanent 계층 파편도 is_anchor=false + importance<0.5 + 180일 미접근 조건 충족 시 cold로 강등된다(parole)
2. **중요도 감쇠(decay)**: PostgreSQL `POWER()` 단일 SQL로 배치 처리. 공식: `importance × 2^(−Δt / halfLife)`. Δt는 `COALESCE(last_decay_at, accessed_at, created_at)` 기준. 적용 후 `last_decay_at = NOW()` 갱신(멱등성 보장). 유형별 반감기 — procedure:30일, fact:60일, decision:90일, error:45일, preference:120일, relation:90일, 나머지:60일. `is_anchor=true` 제외, 최솟값 0.05 보장
3. **만료 파편 삭제 (다차원 GC)**: 5가지 복합 조건으로 판정한다. (a) utility_score < 0.15 + 비활성 60일, (b) fact/decision 고립 파편(접근 0회, 링크 0개, 30일 경과, importance < 0.2), (c) 기존 하위 호환 조건(importance < 0.1, 90일), (d) 해결된 error 파편(`[해결됨]` 접두사 + 30일 경과 + importance < 0.3), (e) NULL type 파편(gracePeriod 경과 + importance < 0.2). gracePeriod 7일 이내 파편은 보호된다. 1회 최대 50건 삭제. `is_anchor=true`, `permanent` 계층 제외
4. **중복 병합**: content_hash가 동일한 파편들을 가장 중요한 것으로 병합. 링크와 접근 통계 통합
5. **누락 임베딩 보충**: embedding이 NULL인 파편에 대해 비동기 임베딩 생성
5.5. **소급 자동 링크**: GraphLinker.retroLink()로 임베딩은 있지만 링크가 없는 고립 파편을 최대 20건 처리하여 관계를 자동 생성
6. **utility_score 재계산**: `importance * (1 + ln(max(access_count, 1))) / age_months^0.3` 공식으로 갱신. 나이(개월)의 0.3제곱을 나누어 오래된 파편의 점수를 점진적으로 낮춘다(1개월÷1.00, 12개월÷2.29, 24개월÷2.88). 이후 ema_activation>0.3 AND importance<0.4인 파편을 MemoryEvaluator 재평가 큐에 등록한다
7. **앵커 자동 승격**: access_count >= 10 + importance >= 0.8인 파편을 `is_anchor=true`로 승격
8. **증분 모순 탐지 (3단계 하이브리드)**: 마지막 검사 이후 신규 파편에 대해 같은 topic의 기존 파편과 pgvector cosine similarity > 0.85인 쌍을 추출(Stage 1). NLI 분류기(mDeBERTa ONNX)로 entailment/contradiction/neutral을 판정(Stage 2) — 높은 신뢰도 모순(conf >= 0.8)은 Gemini 호출 없이 즉시 해소, 확실한 entailment는 즉시 통과. NLI가 불확실한 케이스(수치/도메인 모순)만 Gemini CLI로 에스컬레이션(Stage 3). 확인 시 `contradicts` 링크 + 시간 논리 기반 해소(구 파편 중요도 하향 + `superseded_by` 링크). 해결 결과는 `decision` 타입 파편으로 자동 기록(audit trail) — `recall(keywords=["contradiction","resolved"])`으로 추적 가능. CLI 불가 시 similarity > 0.92인 쌍을 Redis pending 큐에 적재
9. **보류 모순 후처리**: Gemini CLI가 가용해지면 pending 큐에서 최대 10건을 꺼내 재판정
10. **피드백 리포트 생성**: tool_feedback/task_feedback 데이터를 집계하여 도구별 유용성 리포트 생성
10.5. **피드백 적응형 importance 보정**: 최근 24시간 tool_feedback 데이터와 세션 회상 이력을 결합하여 importance를 점진 보정. `sufficient=true` 시 +5%, `sufficient=false` 시 −2.5%, `relevant=false` 시 −5%. 기준: session_id 일치 파편, 최대 20건/세션, lr=0.05, 클리핑 [0.05, 1.0]. is_anchor=true 파편 제외
11. **Redis 인덱스 정리 + stale 파편 수집**: 고아 키워드 인덱스 제거 및 검증 주기 초과 파편 목록 반환
12. **session_reflect 노이즈 정리**: topic='session_reflect' 파편 중 type별 최신 5개만 보존하고, 30일 경과 + importance < 0.3인 나머지를 삭제 (1회 최대 30건)
13. **supersession 배치 감지**: 같은 topic + type이면서 임베딩 유사도 0.7~0.85 구간의 파편 쌍을 Gemini CLI로 "대체 관계인가?" 판단. 확정 시 superseded_by 링크 + valid_to 설정 + importance 반감. GraphLinker의 0.85 이상 구간과 상보적으로 동작
14. **감쇠 적용 (EMA 동적 반감기)**: PostgreSQL `POWER()` 배치 SQL로 파편 전체에 지수 감쇠 적용. `ema_activation`이 높은 파편은 반감기가 최대 2배 연장(`computeDynamicHalfLife`). 공식: `importance × 2^(−Δt / (halfLife × clamp(1 + ema × 0.5, 1, 2)))`
15. **EMA 배치 감쇠**: 장기 미접근 파편의 ema_activation을 주기적으로 축소한다. 60일 이상 미접근 → ema_activation=0(리셋), 30~60일 미접근 → ema_activation×0.5(절반). is_anchor=true 파편 제외. 검색 노출 감소 없이 접근 기록이 없는 파편의 EMA가 과거 부스트 값을 유지하는 현상을 방지한다

---

## 모순 탐지 파이프라인

3단계 하이브리드 구조로 O(N²) LLM 비교 비용을 억제하면서 정밀도를 유지한다.

```
신규 파편 저장 시
       ↓
pgvector cosine similarity > 0.85 후보 필터
       ↓
mDeBERTa NLI (in-process ONNX / 외부 HTTP 서비스)
  ├── contradiction ≥ 0.8  → 즉시 해결 (superseded_by 링크 + valid_to 갱신)
  ├── entailment   ≥ 0.6   → 무관 확정 (링크 미생성)
  └── 그 외 (모호)          → Gemini CLI 에스컬레이션
       ↓
시간축(valid_from/valid_to, superseded_by)으로 기존 데이터 보존
```

- **비용 효율**: 99% 후보를 NLI로 처리, LLM 호출은 수치·도메인 모순에만 발생
- **데이터 무손실**: 파편 삭제 대신 temporal 컬럼으로 버전 관리
- **구현 파일**: `lib/memory/NLIClassifier.js`, `lib/memory/MemoryConsolidator.js`
- **환경변수**: `NLI_SERVICE_URL` 미설정 시 ONNX in-process 자동 사용 (~280MB, 최초 실행 시 다운로드)
