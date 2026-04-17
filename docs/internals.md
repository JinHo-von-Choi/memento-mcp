# Internals

## MemoryManager (조율 계층)

v2.5.2에서 MemoryManager는 1790줄에서 904줄로 경량화되었고, v2.6.0 기준 1,051줄로 CBR/depth 필터가 추가되어, 도구 핸들러와 하위 모듈 간의 조율(orchestration) 계층으로 기능한다. 각 연산의 핵심 로직은 전담 모듈로 위임되며, MemoryManager는 의존성 주입과 메서드 라우팅만 담당한다.

**분해된 모듈:**

| 모듈 | 위임 대상 | 역할 |
|------|----------|------|
| `ContextBuilder` | `context()` | Core/Working/Anchor Memory 조합, rankedInjection, 컨텍스트 힌트 생성 |
| `ReflectProcessor` | `reflect()` | summary/decisions/errors_resolved/new_procedures/open_questions 파편 변환·저장, episode 생성, Working Memory 정리 |
| `BatchRememberProcessor` | `batchRemember()` | Phase A(유효성 검증) → Phase B(트랜잭션 INSERT) → Phase C(후처리) 3단계 일괄 저장 |
| `QuotaChecker` | `remember()` 진입 시 | API 키별 파편 할당량(fragment_limit) 검사 |
| `RememberPostProcessor` | `remember()` 완료 후 | 임베딩 생성, 형태소 인덱싱, 자동 링크, assertion 검사, 시간 링크, 평가 큐 투입, ProactiveRecall 파이프라인. ProactiveRecall 로직 포함 -- remember() 시 키워드 오버랩(>=50%) 기반 유사 파편 자동 `related_to` 링크 생성 |

**위임 패턴:** 각 모듈은 생성자에서 필요한 의존성(store, index, factory, 바인딩된 메서드 등)을 주입받는다. MemoryManager 생성자에서 `this.recall.bind(this)`, `this.remember.bind(this)` 형태로 자기 참조 메서드를 바인딩하여 전달하므로, 모듈이 MemoryManager를 역참조하지 않는다.

**reflect의 resolution_status 자동 세팅:** ReflectProcessor는 reflect 생성 파편에 resolution_status를 자동 부여한다. `errors_resolved` 항목은 `resolutionStatus: "resolved"`로, `open_questions` 항목은 `resolutionStatus: "open"`으로 설정된다. 또한 모든 reflect 생성 파편에 `sessionId`가 전파되어 세션 단위 추적이 가능하다.

---

## MemoryEvaluator

서버가 시작되면 MemoryEvaluator 워커가 백그라운드에서 구동된다. `getMemoryEvaluator().start()`로 시작되는 싱글턴이다. SIGTERM/SIGINT 수신 시 graceful shutdown 흐름에서 중지된다.

워커는 5초 간격으로 Redis 큐 `memory_evaluation`을 폴링한다. 큐가 비어 있으면 대기한다. 큐에서 잡(job)을 꺼내면 Gemini CLI(`geminiCLIJson`)를 호출하여 파편 내용의 합리성을 평가한다. 평가 결과는 fragments 테이블의 utility_score와 verified_at을 갱신하는 데 사용된다.

새 파편이 remember로 저장될 때 평가 큐에 투입된다. 단, fact, procedure, error 유형은 제외된다. 평가 대상은 decision, preference, relation 유형이다. 평가는 저장과 비동기로 분리되어 있으므로 remember 호출의 응답 시간에 영향을 주지 않는다.

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

### compressOldFragments (KNN 배치 병렬화)

`ConsolidatorGC.compressOldFragments()`는 장기 미접근·저중요도 파편을 topic별로 그룹핑한 뒤 KNN(cosine >= 0.80)으로 유사 그룹을 형성하여 대표 파편으로 압축한다. v2.5.2에서 KNN 이웃 조회가 순차 N+1 쿼리에서 `BATCH_SIZE=20` 단위 `Promise.all` 병렬로 전환되었다. 배치 내 각 파편의 pgvector KNN 쿼리가 동시에 실행되므로, 대상 파편이 많을수록 처리 시간이 선형 대비 크게 단축된다. 개별 쿼리 실패는 `.catch(() => ({ rows: [] }))`로 격리되어 배치 전체를 차단하지 않는다.

---

## 세션 및 인증 내부 동작

### forget/amend/link 에러 통합 패턴

forget, amend, link, fragment_history 연산은 파편을 먼저 `store.getById(id, agentId, keyId, groupKeyIds)`로 조회한다. SQL 쿼리에 `key_id` 조건이 포함되므로 타 테넌트 파편은 SELECT 단계에서 이미 필터된다. 조회 결과가 null이면 파편의 실제 존재 여부와 무관하게 동일한 에러 메시지를 반환한다.

| 연산 | 에러 메시지 |
|------|------------|
| `forget(id=...)` | `"Fragment not found or no permission"` |
| `amend(id=...)` | `"Fragment not found or no permission"` |
| `link(fromId=..., toId=...)` | `"One or both fragments not found or no permission"` |
| `fragment_history(id=...)` | `"Fragment not found or no permission"` |

이 패턴은 존재 여부 노출(existence oracle) 취약점을 방지한다. 공격자가 타 테넌트 파편 ID를 추측하더라도 "없음"과 "권한 없음"을 구분할 수 없다.

### injectSessionContext 헬퍼

`lib/handlers/mcp-handler.js`에서 export되며, SSE 핸들러(`sse-handler.js`)에서도 import하여 재사용된다.

```js
injectSessionContext(msg, { sessionId, sessionKeyId, sessionGroupKeyIds,
                             sessionPermissions, sessionDefaultWorkspace });
```

`tools/call` 메서드에만 동작한다. 클라이언트가 직접 전송한 `_keyId`, `_groupKeyIds`, `_sessionId`, `_permissions`, `_defaultWorkspace` 필드를 먼저 삭제한 뒤, 서버 인증 결과로 재주입한다. 클라이언트가 세션 컨텍스트를 위조하는 경로를 완전히 차단한다.

### AdminEsmLoadError sentinel 패턴

`tests/unit/admin-test-helper.js`의 `loadAdmin()`은 `assets/admin/admin.js`를 Node.js `vm.runInContext`로 로드한다. v2.5.7에서 admin.js가 ESM 진입점(import/export 문 포함)으로 전환된 이후, vm sandbox는 ESM 문법을 지원하지 않아 SyntaxError가 발생한다.

이를 명시적으로 처리하기 위해 ESM 파일 감지 시 `AdminEsmLoadError`를 throw한다. 테스트 파일은 이 에러를 catch하여 `describe.skip`으로 전환한다. 실제 에러와 sentinel을 구분하는 가드:

```js
} catch (e) {
  if (!(e instanceof AdminEsmLoadError)) throw e;
}
const _describe = _adminLoaded ? describe : describe.skip;
```

admin 모듈 테스트는 향후 `assets/admin/modules/*`를 직접 import하는 방식으로 마이그레이션 예정이다.

---

## 세션 및 인증 내부 동작

### updateTtlTier key_id 격리

`FragmentWriter.updateTtlTier`는 `keyId` 파라미터를 받아 UPDATE 쿼리에 `key_id` 조건을 추가한다. 다른 API 키가 소유한 파편의 TTL 계층을 변경하는 크로스 키 접근을 차단한다. keyId가 null이면 마스터 키 소유 파편(`key_id IS NULL`)만 대상으로 한다.

### workspace 필터 전파

`FragmentSearch._buildSearchQuery()`는 쿼리에서 `workspace` 값을 정규화하여 `sq.workspace`로 보관한다. `_executeSearch()`는 이를 L2(keyword/topic) 검색 options와 L3(semantic) searchBySemantic 8번째 인자로 전달한다.

`FragmentReader`의 `searchByKeywords`, `searchByTopic`, `searchBySemantic`, `searchByTimeRange`, `searchAsOf`, `searchBySource` 6개 메서드 모두 `(workspace = $N OR workspace IS NULL)` 조건을 지원한다. `_searchTemporal`도 `searchByTimeRange` 호출 시 `workspace: sq.workspace`를 전달한다.

`MemoryManager`의 workspace 해석 우선순위: `params.workspace ?? params._defaultWorkspace ?? null`. `_defaultWorkspace`는 인증 시 키의 `api_keys.default_workspace`에서 읽혀 세션에 저장되며, 도구 호출 시 `args._defaultWorkspace`로 주입된다.

### 세션 자동 복구

세션 스토어에서 "Session not found" 또는 "Session expired" 오류가 발생하면 서버가 재인증 흐름을 즉시 실행한다.

**v2.8.1 동일 ID 복구**: 재인증 성공 시 `crypto.randomUUID()`로 새 ID를 발급하지 않고, 클라이언트가 보낸 원본 `sessionId`를 `createStreamableSessionWithId`에 그대로 전달하여 동일 ID로 세션을 재생성한다. 클라이언트 입장에서 세션이 끊기지 않고 연속 사용 가능하다. 로그 형식: `[Streamable] Session recovered with same-id: <sessionId> (keyId: ...)`.

**keyId 교차 검증**: 복구 수행 전 Redis에서 기존 세션 데이터를 조회한다. 기존 세션이 존재하고 `session.keyId !== authResult.keyId`이면 403 Forbidden을 반환하고 복구를 거부한다. `recordTenantIsolationBlocked("session_recover_keyid_mismatch")`와 `recordSessionRecovery("keyid_mismatch")`가 호출된다. Redis가 비활성화되어 있거나 기존 세션이 없으면 검증을 건너뛰고 동일 ID 복구를 진행한다.

Legacy SSE 세션도 요청마다 `expiresAt`을 `now + SESSION_TTL_MS`로 갱신하는 슬라이딩 윈도우 방식을 적용한다.

### 세션 idle reflect

`cleanupExpiredSessions`는 만료 체크 전에 `MCP_IDLE_REFLECT_HOURS`(기본 24시간) 이상 비활성 상태인 세션에 대해 `autoReflect(sessionId)`를 실행한다. 이 기능은 장기 세션(30일 TTL)에서 중간 기억 요약이 없어 기억이 손실되는 문제를 방지한다.

동작 조건: `(now - session.lastAccessedAt) > idleThresholdMs` AND (`session.lastReflectedAt`이 없거나 `(now - session.lastReflectedAt) > idleThresholdMs`). 성공 후 `session.lastReflectedAt = now`로 갱신하여 중복 실행을 방지한다. 실패해도 루프 계속. 메트릭: `mcp_session_idle_reflect_total`.

### Redis TTL 동기화

`validateStreamableSession`은 세션 갱신 시 고정된 `CACHE_SESSION_TTL` 대신 Redis에서 읽은 실제 잔여 TTL을 사용한다. 세션이 만료에 가까워질수록 갱신 후에도 남은 시간이 정확히 보존된다.

### SSE 연결 해제

SSE 스트림이 닫히면(`res.on('close')`) 서버는 SSE 응답 객체만 제거하고 세션 자체는 유지한다. 세션은 Redis TTL이 소진될 때까지 살아있으며, 클라이언트가 재연결하면 동일 세션을 이어서 사용할 수 있다.

### OAuth 보안 모델 — keyId가 없는 OAuth는 master 권한이 아님

`validateAuthentication`의 OAuth 분기는 세 가지 우선순위 경로로 처리된다.

1. **bound_key_id 경로 (v2.8.4, 1순위)**: 토큰의 `bound_key_id` 필드가 있으면 `validateApiKeyById(bound_key_id)`로 UUID 직접 조회. name-based client_id 바인딩 방식이 이 경로를 사용한다. 성공 시 `keyId`/`groupKeyIds`/`permissions` 반환. `mcp_oauth_bound_client_authenticated_total` 카운터 증가.
2. **is_api_key=true 경로 (v2.8.3 호환, 2순위)**: `client_id`가 원본 API 키 문자열인 경우 `validateApiKeyFromDB(client_id)`로 조회. bound_key_id 조회 실패 시에도 이 경로로 낙하.
3. **non-API-key OAuth (3순위)**: `MCP_REJECT_NONAPIKEY_OAUTH=true`(기본)이면 `{ valid: false, error: "non-API-key OAuth denied" }` 반환. `mcp_oauth_nonapikey_rejected_total` + `memento_tenant_isolation_blocked_total{component="oauth_nonapikey_denied"}` 카운터 증가. `false`이면 하위 호환 동작 (`keyId=null` 세션 — 운영 환경에서 절대 사용하지 말 것).

### OAuth name-based client_id 바인딩 (v2.8.4)

`POST /register` 시 `Authorization: Bearer <API 키>` 헤더가 유효하면:

- `client_id = "<name>_<keyIdHex8>"` — API 키 `name` 필드 + UUID 앞 8자 hex suffix. URL-safe, 예측 불가, 충돌 방지.
- `client_name = "apikey:<keyId UUID>"` — 서버 내부 바인딩 마커. `oauth_clients` 테이블의 기존 `client_name` 컬럼을 재사용하며 스키마 변경 없음.

`/authorize` 처리 시 `getClient(client_id)`로 등록된 클라이언트를 조회한 뒤 `client_name`이 `apikey:<uuid>` 패턴이면 `validateApiKeyById(uuid)`로 유효성 확인. 성공 시 `bound_key_id`를 codeData에 기록하고 `/token` 발급까지 전파. `validateAccessToken` 반환에도 `bound_key_id` 포함.

헤더 없거나 유효하지 않으면 기존 랜덤 client_id 생성(fallback)으로 처리되며, 이 경우 `REJECT_NONAPIKEY_OAUTH` 정책에 의해 토큰이 거부된다.

v2.8.3에서 API 키 원문을 client_id로 등록한 기존 Redis 토큰은 `bound_key_id=null`이므로 2순위 `is_api_key` 경로로 정상 처리된다 (backward compat).

**AUTO-REGISTRATION 차단**: `/authorize` GET 요청에서 미등록 `client_id`가 유효한 `redirect_uri`만 있으면 자동으로 클라이언트를 생성하던 경로는 `MCP_ALLOW_AUTO_DCR_REGISTER=false`(기본)로 차단된다. 미등록 클라이언트는 반드시 `POST /register`(RFC 7591)로 사전 등록해야 한다. 차단 시 `mcp_oauth_auto_register_blocked_total` 카운터 증가.

**ACCESS_KEY 직접 사용**: `Authorization: Bearer <ACCESS_KEY>` 헤더는 OAuth 분기 진입 전 `safeCompare`에서 처리되므로 위 분기와 무관하다.

### OAuth refresh_token의 is_api_key 전파

`POST /token` 에서 `grant_type=refresh_token`으로 토큰을 갱신할 때, 원본 토큰의 `is_api_key` 플래그가 새로 발급되는 access_token과 refresh_token에 그대로 전파된다. API 키 기반 클라이언트가 갱신 후에도 동일한 격리 컨텍스트를 유지한다.

### SESSION_TTL 기본값 변경

`SESSION_TTL` 환경변수의 기본값이 240분에서 43200분(30일)으로 변경되었다. 슬라이딩 윈도우 방식으로 도구 사용 시마다 TTL이 갱신되므로, 30일 비활동 후에만 만료된다. 활발히 사용 중인 세션은 사실상 만료되지 않는다.

---

## EmbeddingCache (쿼리 임베딩 캐시)

`FragmentSearch._searchL3()`에서 쿼리 텍스트의 임베딩 벡터를 Redis에 캐싱하여 반복 검색 레이턴시를 감소시킨다.

**키 패턴:** `emb:q:{SHA-256 앞 16자}`. 동일 쿼리 텍스트는 항상 같은 키에 매핑된다.

**값 형식:** `Float32Array`를 `Buffer`로 바이너리 직렬화하여 저장. 조회 시 역직렬화하여 `number[]`로 반환.

**TTL:** 기본 3600초(1시간). 생성자 `ttlSeconds` 옵션으로 조정 가능.

**장애 격리:** 모든 Redis 호출은 try-catch로 감싸고, 실패 시 null/무시 반환. 캐시 장애가 검색 흐름을 차단하지 않는다. Redis 미설정(status === "stub") 시 항상 cache miss로 동작.

---

## Reranker (Cross-Encoder 재정렬)

RRF 병합 이후 상위 30건을 cross-encoder로 정밀 재정렬하여 검색 정확도를 높인다. 서버 시작 시 `preloadReranker()`를 비동기로 호출하여 첫 recall 요청 전에 모델을 준비한다.

**듀얼 모드:**
- `RERANKER_URL` 설정 시: 외부 HTTP 서비스 (`POST /rerank { query, documents[] } → { scores[] }`)
- 미설정 시: `@huggingface/transformers` + ONNX in-process

**In-Process 모델 선택 (`RERANKER_MODEL`):**

| 값 | 모델 | 크기 | 언어 | 권장 대상 |
|----|------|------|------|-----------|
| `minilm` (기본값) | Xenova/ms-marco-MiniLM-L-6-v2 | ~80MB | 영어 전용 | 영어 사용자 |
| `bge-m3` | onnx-community/bge-reranker-v2-m3-ONNX | ~280MB (q4) | 100+ 언어 (한국어 포함) | 비영어권 사용자 |

> **비영어권 사용자는 `RERANKER_MODEL=bge-m3` 사용을 권장한다.** ms-marco-MiniLM-L-6-v2는 영어 MS MARCO 데이터셋으로만 학습되어 한국어 등 비영어 쿼리-문서 쌍의 관련성 판단 능력이 없다. bge-m3는 동일한 ONNX in-process 방식으로 동작하며, 첫 실행 시 HuggingFace Hub에서 자동 다운로드된다.

**외부 서비스 장애 자동 전환:** 연속 3회 실패 시 inprocess 모드로 자동 전환. 외부 서비스가 복구되어도 재시작 전까지 inprocess 유지. 어느 모드든 scores 반환 실패 시 RRF 결과 그대로 반환(graceful degradation).

**최종 스코어:** `sigmoid(logit) * recency_boost`. recency_boost는 생성일 기준 365일 선형 감쇠 [0.9, 1.1] 범위.

---

## TemporalLinker (시간 기반 자동 링크)

`remember()` 호출 시 `MemoryManager._autoLinkOnRemember()` 체인에서 비동기로 실행된다. 동일 `topic` 내 ±24h 윈도우에 있는 기존 파편과 `temporal` 링크를 최대 5건 생성한다.

**가중치 공식:** `max(0.3, 1.0 - hours/24)` — 시간 차 0h=1.0, 12h=0.5, 24h=0.3.

**API 키 격리:** `options.keyId`를 쿼리에 `key_id = ANY($n)`으로 전달하여 타 API 키 소유 파편을 temporal 링크 대상에서 제외한다.

fragment_links.weight 컬럼은 migration-023에서 integer→real로 변경되어 float 가중치를 지원한다.

---

## CaseEventStore

case_events 테이블에 semantic milestone을 기록하고 조회하는 전담 스토어다. `MemoryManager`에 주입되어 `reconstructHistory()` 경로에서 사용된다.

**주요 메서드:**

| 메서드 | 설명 |
|--------|------|
| `append(caseId, sessionId, eventType, summary, keyId)` | 신규 이벤트 기록. sequence_no에 `FOR UPDATE` 잠금으로 동시성 제어 |
| `addEdge(fromId, toId, edgeType, confidence)` | 이벤트 간 DAG 엣지 추가 |
| `addEvidence(fragmentId, eventId, kind)` | 파편-이벤트 증거 조인 기록 |
| `getByCase(caseId, opts)` | 케이스 범위 이벤트 목록 조회 (occurred_at 오름차순) |
| `getBySession(sessionId, opts)` | 세션 범위 이벤트 목록 조회 |
| `getEdgesByEvents(eventIds)` | 이벤트 ID 목록에 해당하는 모든 엣지 일괄 조회 |

**event_type 8종:**

- `milestone_reached` — 목표 이정표 도달
- `hypothesis_proposed` — 가설 제안
- `hypothesis_rejected` — 가설 기각
- `decision_committed` — 의사결정 확정
- `error_observed` — 에러 관측
- `fix_attempted` — 수정 시도
- `verification_passed` — 검증 통과
- `verification_failed` — 검증 실패

**동시성:** `append()` 내부에서 `SELECT sequence_no FROM case_events WHERE case_id = $1 FOR UPDATE`로 배타적 행 잠금을 획득한 뒤 INSERT를 수행한다. 동일 케이스에 이벤트가 동시 삽입될 때 sequence_no 중복을 방지한다.

---

## HistoryReconstructor

`case_id` 또는 `entity` 키워드를 기준으로 파편과 이벤트를 수집하여 시간순 서사를 재구성한다. `MemoryManager.reconstructHistory()`에서 호출된다.

**`reconstruct(params)` 반환 구조:**

| 필드 | 설명 |
|------|------|
| `ordered_timeline` | 파편 목록 (created_at 오름차순) |
| `causal_chains` | BFS로 투영된 인과 체인 배열 |
| `unresolved_branches` | 미해결 브랜치 목록 |
| `supporting_fragments` | 인과 체인의 근거 파편 목록 |
| `case_events` | 해당 케이스/세션의 이벤트 목록 |
| `event_dag` | case_event_edges DAG 표현 |
| `summary` | 서사 요약 텍스트 |

**BFS 인과 체인 알고리즘:**

`fragment_links`의 `caused_by` / `resolved_by` 엣지와 `case_event_edges`의 동일 타입 엣지를 통합하여 단일 그래프를 구성한다. 시작 노드에서 BFS를 수행하여 도달 가능한 모든 인과 체인을 추출한다. 사이클은 방문 집합(visited set)으로 차단한다.

**미해결 브랜치 탐지:**

다음 두 조건을 OR로 수집한다.
- `fragments.resolution_status = 'open'`인 파편
- `case_events.event_type = 'error_observed'`이면서 해당 이벤트에서 출발하는 `resolved_by` 엣지가 없는 이벤트

---

## ReconsolidationEngine (링크 동적 갱신)

`lib/memory/ReconsolidationEngine.js`는 fragment_links의 weight와 confidence를 동적으로 갱신하고 변경 이력을 link_reconsolidations 테이블에 기록한다.

**reconsolidate(linkId, action, opts) — 5가지 action:**

| action | weight 변화 | confidence 변화 | 추가 효과 |
|--------|------------|----------------|---------|
| reinforce | +0.2 | +0.05 | |
| decay | -0.15 | -0.1 | |
| quarantine | -0.3 | -0.1 | quarantine_state = 'soft' |
| restore | +0.3 | +0.05 | quarantine_state = 'released' |
| soft_delete | 0 | 0 | deleted_at = NOW() |

weight는 [0, 2] 범위로 클램핑되며, confidence는 [0, 1] 범위로 클램핑된다.

**rate-limit:** decay/quarantine 계열 action은 동일 link_id에 대해 60초 내 재실행이 차단된다(in-memory Map, lastDecayAt).

**quarantineAdjacentLinks(fromId, toId, keyId):** contradicts 충돌 감지 시 ConflictResolver가 호출한다. 해당 두 파편 간에 존재하는 related/temporal 관계 링크를 모두 soft quarantine한다.

**ENABLE_RECONSOLIDATION 환경변수:** `true`로 설정해야 활성화된다(기본값: false). 비활성 시 tool_feedback과 ConflictResolver 모두 reconsolidate를 호출하지 않는다.

---

## EpisodeContinuityService (에피소드 연속성)

`lib/memory/EpisodeContinuityService.js`는 reflect() 호출 시 episode 파편에 case_events milestone을 삽입하고 이전 에피소드와 preceded_by 엣지로 연결한다.

**linkEpisodeMilestone(episodeFragmentId, agentId, keyId, sessionId):**

1. fragment 내용 첫 200자를 요약으로 조회
2. milestone_reached 이벤트를 case_events에 삽입 (ON CONFLICT idempotency_key DO NOTHING — 중복 방지)
3. 동일 agentId의 직전 milestone eventId가 캐시에 있으면 preceded_by 엣지 삽입
4. lastEventByAgent Map에 현재 eventId 저장

**idempotency_key 형식:** `milestone:{agentId}:{sessionId}:{fragmentId}` — 서버 재시작 후 동일 호출이 재발생해도 중복 이벤트가 생성되지 않는다.

MemoryManager.reflect() 완료 후 fire-and-forget으로 호출된다. 실패해도 reflect 결과에 영향을 주지 않는다.

---

## SpreadingActivation (확산 활성화)

`lib/memory/SpreadingActivation.js`는 현재 대화 맥락(contextText)에서 관련 파편을 선제적으로 활성화한다. ACT-R Spreading Activation 모델 기반.

**activateByContext(contextText, agentId, keyId, sessionId):**

1. FragmentFactory.extractKeywords()로 contextText에서 키워드 최대 8개 추출
2. keywords GIN 인덱스로 seed 파편 최대 10건 조회 (valid_to IS NULL, key_id 격리 적용)
3. fetchGraphNeighbors()로 1-hop 그래프 확산 (최대 10건)
4. 활성화된 파편 IDs를 activationQueue에 적재 → drainQueue()에서 activation_score +0.1, accessed_at/access_count 갱신

**캐시:** `{agentId}:{keyId}:{sessionId}` 키로 10분 TTL. 동일 세션 내 이미 활성화된 파편을 중복 처리하지 않는다.

MemoryManager.recall()에서 fire-and-forget으로 호출된다. `ENABLE_SPREADING_ACTIVATION=true`일 때만 활성화(기본값: false).

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

---

## Smart Recall (v2.5.6)

remember/recall 파이프라인에 3개의 자동 학습 서브시스템이 추가되었다.

### ProactiveRecall (RememberPostProcessor)

remember() 후처리 파이프라인의 마지막 단계. 저장된 파편의 키워드로 L1/L3 검색을 수행하고, 기존 파편과 keyword overlap >= 0.5인 경우 `related_to` 링크를 생성한다.

- 검색: `FragmentSearch.search({ keywords, tokenBudget: 400, fragmentCount: 5 })`
- 링크 기준: `|shared_keywords| / max(|new_kw|, |candidate_kw|) >= 0.5`
- fire-and-forget: `_proactiveRecallPromise`로 추적 (테스트 안정성)
- 임베딩 미사용: remember 시점에 임베딩이 아직 생성되지 않으므로 keyword 경로만 사용

### CaseRewardBackprop (CaseEventStore -> CaseRewardBackprop)

case_events에 verification 이벤트가 추가되면, 해당 케이스의 증거 파편(fragment_evidence JOIN) importance를 원자적으로 조정한다.

- SQL: `UPDATE fragments SET importance = LEAST(1.0, GREATEST(0.0, importance + $delta)) FROM fragment_evidence, case_events WHERE ...`
- 동시성: UPDATE FROM은 행 잠금으로 원자적. read-modify-write race condition 없음.
- 트리거: `CaseEventStore.append()` COMMIT 후 fire-and-forget
- 싱글톤: `getBackprop()` (서버 수명 동안 공유)

### SearchParamAdaptor (FragmentSearch -> SearchParamAdaptor)

검색 호출마다 결과 건수를 `search_param_thresholds` 테이블에 기록하고, minSimilarity를 DB-level CASE 표현식으로 원자적 조정한다.

- 테이블: `agent_memory.search_param_thresholds` (migration-029)
- 키: `(key_id, query_type, hour_bucket)` — key_id=-1은 마스터/전체 기본값
- 학습: `sample_count >= 50` 이후 적용
- 적응: `avg_result < 1 -> -0.01`, `avg_result > 8 -> +0.01` (대칭, [0.10, 0.60])
- UPSERT: SELECT 없이 단일 INSERT...ON CONFLICT DO UPDATE (TOCTOU-free)
- 통합: `_buildSearchQuery()`에서 Promise 부착, `_searchL3()`에서 await

---

## Symbolic Memory Layer Internals (v2.8.0)

architecture.md의 Symbolic Memory Layer 섹션이 전체 설계를 다룬다. 이 챕터는 각 모듈의 구현 세부사항 중심으로 서술한다.

### SymbolicOrchestrator

`lib/symbolic/SymbolicOrchestrator.js`. 생성자: `({ config, metrics, rulePackLoader })`. 세 의존성 모두 기본값(프로덕션 싱글톤)이 제공되며 테스트에서 교체 가능한 DI 구조다. `evaluate({ mode, candidates, ctx, timeoutMs, ruleVersion, correlationId })` 진입점은 5개 모드(`recall|remember|link|explain|shadow`)를 처리한다.

`config.enabled=false`이면 즉시 noop 결과를 반환하여 CPU 비용 0. timeout은 `Promise.race([evalPromise, timeoutPromise])`로 구현하며 초과 시 `degraded=true`를 반환하고 절대 throw하지 않는다. `clearTimeout` 처리로 타이머 누수를 방지한다. `rule_version`과 `correlation_id`는 모든 evaluate 호출에 수반되며, 결과 객체에 `ruleVersion`으로 반영된다.

### SymbolicMetrics

`lib/symbolic/SymbolicMetrics.js`. prom-client 4종 메트릭을 모듈 로드 시 즉시 등록한다:
- `memento_symbolic_claim_extracted_total` (labels: extractor, polarity)
- `memento_symbolic_warning_total` (labels: rule, severity)
- `memento_symbolic_gate_blocked_total` (labels: phase, reason)
- `memento_symbolic_op_latency_ms` histogram (labels: op, buckets: 1~500ms)

`recordClaim(extractor, polarity)`, `recordWarning(rule, severity)`, `recordGateBlock(phase, reason)`, `observeLatency(op, ms)` 4개 헬퍼로 외부 호출을 통일한다. 싱글톤 `symbolicMetrics` export 및 DI 주입 방식을 동시 지원한다.

### ClaimExtractor

`lib/symbolic/ClaimExtractor.js`. `MorphemeIndex.tokenize`를 async로 호출하고 실패 시 공백 분리 fallback을 사용한다. polarity 판정 우선순위는 `uncertain > negative > positive`이며 negative 마커 존재 시 positive 마커가 공존해도 negative로 결정한다. 공백 변형 흡수를 위해 원문 및 공백 제거본을 동시에 검사한다. 규칙 기반 extractor confidence 범위는 0.5~0.8, 불확실 구간은 0.4~0.5이다.

### ClaimStore

`lib/symbolic/ClaimStore.js`. `TEXT key_id`를 사용하고 모든 쿼리에서 `key_id IS NOT DISTINCT FROM $N` 패턴으로 테넌트 격리한다. 이 연산자는 NULL=NULL을 true로 취급하므로 master(NULL)와 tenant(TEXT)를 단일 분기 없이 처리한다. v2.5.7 이후 금지된 `(key_id IS NULL OR key_id = $N)` 패턴은 사용하지 않는다.

`insert` 진입부에서 `fragment.key_id !== ctx.keyId` 불일치를 확인하고 `TENANT_ISOLATION_VIOLATION` 예외를 throw한다. `findPolarityConflicts`는 동일 (subject, predicate, COALESCE(object,''))에서 positive↔negative 쌍을 confidence threshold 기반으로 조회한다. migration-032에서 복제한 partial unique 인덱스 2개(master NULL 전용, tenant TEXT 전용)가 ON CONFLICT 경로의 cross-tenant 누출을 차단한다.

### ClaimConflictDetector

`lib/symbolic/ClaimConflictDetector.js`. `ClaimStore.findPolarityConflicts` SQL 로직에 위임하고 severity 계산·메트릭 기록·결과 정규화를 담당한다(단일 책임). severity 산정: 충돌 1건 → `low`, 2~3건 → `medium`, 4건 이상 → `high`. ClaimStore 예외는 여기서 흡수하며 `degraded=true` 결과를 반환해 neural 경로 fallback을 막지 않는다. DI: `({ claimStore, metrics })`.

### LinkIntegrityChecker

`lib/symbolic/LinkIntegrityChecker.js`. `sessionLinker.wouldCreateCycle(fromId, toId, agentId, keyId)` 4-arg 시그니처를 재사용한다. Phase 0.5에서 이 시그니처를 추가함으로써 Phase 3 구현이 기존 코드를 재사용할 수 있었다. `DIRECTIONAL_RELATIONS = {caused_by, resolved_by, superseded_by, preceded_by}` 외 타입은 early return하여 무방향 링크의 불필요한 사이클 검사를 회피한다. advisory only: `hasCycle=true`여도 block하지 않는다. DI: `({ sessionLinker })`.

### ExplanationBuilder

`lib/symbolic/ExplanationBuilder.js`. `annotate(fragments, searchContext)` 진입점은 `fragments.map`으로 불변 복사(`{ ...fragment, explanations: reasons }`)를 반환한다. 원본 fragment 객체(Hot Cache, FragmentStore 공유 참조)는 절대 변경되지 않는다. `reasonBuilder`는 DI로 교체 가능하며 기본값은 `rules/v1/explain.js`의 `buildReasonCodes`다. 빈 입력이면 no-op 반환으로 GC 부하를 최소화한다. 싱글톤 `explanationBuilder` export로 `FragmentSearch`와 공유된다.

### PolicyRules

`lib/symbolic/PolicyRules.js`. 5개 predicate를 순수 동기 함수로 구현한다:
1. `decisionHasRationale`: decision 타입에서 `linked_to >= 2` 또는 `RATIONALE_REGEX` 매칭
2. `errorHasResolutionPath`: error 타입에서 `CAUSE_FIX_REGEX` 매칭 또는 `resolution_status` 존재
3. `procedureHasStepMarkers`: procedure 타입에서 `STEP_MARKER_REGEX` 매칭
4. `caseIdHasResolutionStatus`: case_id 보유 파편이 `resolution_status` 누락
5. `assertionNotContradictory`: `assertion_status`가 동시에 verified이면서 rejected인 경우

`check(fragment)` 반환: `[{ rule, severity, detail, ruleVersion }]`. DB 조회 없음, 순수 JS 동기.

### CbrEligibility

`lib/symbolic/CbrEligibility.js`. 비동기 DB 조회 없이 인메모리 fragment 필드만으로 동기 결정 가능한 4제약을 적용한다: `tenant_match`, `has_case_id`, `not_quarantine` (quarantine_state !== 'soft'), `resolved_state` (resolution_status 가 `resolved`이거나 null/undefined). 차단된 각 fragment에 대해 `symbolicMetrics.recordGateBlock('cbr', reason)`을 호출한다. DI: `({ metrics })`.

### 5 Rule Files (lib/symbolic/rules/v1/)

**explain.js**: `buildReasonCodes(fragment, searchContext)` 함수. 입력: fragment (searchPath, layerLatency 메타데이터 포함) + searchContext. 출력: 최대 3개 reason code 배열. L3 형태소 경로는 `direct_keyword_match`, pgvector L2는 `semantic_similarity`, 그래프 1-hop은 `graph_neighbor_1hop`, timeRange 매칭은 `temporal_proximity`, case cohort는 `case_cohort_member`, EMA 활성화(`>= 0.5`)는 `recent_activity_ema`.

**link-integrity.js**: `checkCycle(input, ctx)` rule function. `LinkIntegrityChecker` 인스턴스를 생성하여 `sessionLinker`를 ctx에서 주입받아 호출한다. DIRECTIONAL_RELATIONS 외 타입은 `{ hasCycle: false, reason: 'non_directional' }` early return.

**claim-conflict.js**: `detectPolarityConflict({ fragmentId, keyId }, { detector })`. `ClaimConflictDetector` DI 주입으로 테스트 격리. 입력 fragmentId에 대한 polarity 충돌을 탐지하고 severity 포함 결과를 반환한다.

**policy.js**: `evaluatePolicy(fragment, _ctx)`. `PolicyRules` 싱글톤 인스턴스를 모듈 로드 시 생성한다. `_ctx`는 현재 미사용이며 future signature 호환용으로 보존된다.

**proactive-gate.js**: `evaluateProactiveGate({ source, target, keyId }, _ctx)`. 비용 순 우선 검사: `invalid_target` → `quarantine` → `cohort_mismatch` → `polarity_conflict`. `ClaimConflictDetector` throw는 fail-open(allowed=true 반환). 반환: `{ allowed, reason, ruleVersion }`.

### RememberPostProcessor 8단계 및 _extractSymbolicClaims 경로

`lib/memory/RememberPostProcessor.js`의 `run()` 메서드는 8단계를 순차 실행한다. 8단계는 Symbolic claim extraction(Phase 1)이며 `this._symbolicClaimPromise = this._extractSymbolicClaims(...).catch(...)` fire-and-forget 패턴으로 진행한다. 메인 파이프라인을 블로킹하지 않으며 실패해도 기억 저장에 영향을 주지 않는다.

`_extractSymbolicClaims(fragment, { agentId, keyId })`: `SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.claimExtraction` 가드 → `ClaimExtractor.extract` → `ClaimStore.insert`. TENANT_ISOLATION_VIOLATION 예외는 `symbolicMetrics.recordGateBlock("claim_extraction", "tenant_violation")` 후 swallow. 성공 claim마다 `symbolicMetrics.recordClaim(extractor, polarity)` 호출.

### FragmentSearch Hook Chain 삽입 위치

`lib/memory/FragmentSearch.js` 라인 88 이후 3개 hook이 순서대로 실행된다:
1. **shadow hook** (라인 99): `SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.shadow` → `symbolicMetrics.observeLatency("shadow_recall", ...)` 기록만
2. **explain hook** (라인 107): `SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.explain` → `explanationBuilder.annotate(clean, { searchPath, layerLatency, query, caseContext })`
3. **cbr filter** (라인 124): `SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.cbrFilter && sq.caseId` → `cbrEligibility.filter(clean, sq)`. pre-filter `rawResultCount`는 SearchParamAdaptor 학습 신호 보호를 위해 별도 보존.

### ConflictResolver.checkAssertionConsistency 및 validationWarnings 병기

`lib/memory/ConflictResolver.js`의 `checkAssertionConsistency`는 기존 Jaccard 파이프라인(`JACCARD_THRESHOLD=0.3`, 7일 창 최대 10건)을 보존하면서 Phase 3 symbolic polarity 충돌 결과를 병기한다. `SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.polarityConflict` 가드 내에서 `ClaimConflictDetector.detectPolarityConflicts`를 호출하며 예외는 logWarn 후 swallow한다. polarity 충돌에서 발견된 `conflictWith` ID는 기존 `supersedeCandidates`에 병합된다. 반환 타입이 `{ assertionStatus, supersedeCandidates, validationWarnings }` 3-tuple로 확장되었으며, 플래그 off 시 `validationWarnings: []`로 빈 배열을 반환한다.

---

## MCP 2025-06-18 스펙 준수 (v2.8.2)

### 세션 404 반환

MCP 2025-06-18 스펙은 서버가 세션을 종료한 후 해당 sessionId를 포함한 요청에 HTTP 404를 반환하도록 요구한다.

구현 위치: `lib/handlers/mcp-handler.js#handleMcpPost`

`sessionId` 헤더가 있으나 `validateStreamableSession`이 실패한 경우, 다음 두 경로에서 HTTP 404 + JSON-RPC `-32000 "Session not found"` 를 반환한다:

- `reason === "Session not found"` && 인증 실패: 세션이 없고 재인증도 안 됨 → 복구 불가
- `reason === "Session expired"` && 인증 실패: 세션이 만료되어 복구 불가

인증이 성공하는 경우(=복구 가능)는 Phase 1-1 경로(동일 ID 재생성)로 진행하며 404를 반환하지 않는다. keyId 불일치는 403을 반환한다.

메트릭: `mcp_session_404_total` (label 없음)

### Origin 헤더 검증 (DNS rebinding 방어)

`MCP_STRICT_ORIGIN=true` 설정 시 POST/GET/DELETE `/mcp` 진입점 최상단에서 `isOriginAllowed(req)` 검증을 수행한다. 함수는 `lib/handlers/_common.js`에 위치한다.

허용 조건:
- Origin 헤더 없음 (CLI/curl 등 비브라우저 클라이언트)
- `STRICT_ORIGIN=false` (기본값 — opt-in)
- Origin이 허용 목록에 포함됨: `https://claude.ai`, `https://chatgpt.com`, `https://platform.openai.com`, `OAUTH_TRUSTED_ORIGINS` 목록, `ALLOWED_ORIGINS` Set

거부 조건: 위 이외의 Origin → HTTP 403 + JSON-RPC `-32000 "Origin not allowed"`

메트릭: `mcp_origin_rejected_total` (label: `origin`)

### MCP-Protocol-Version 헤더 검증

initialize 이후 모든 요청에서 `MCP-Protocol-Version` 헤더를 검사한다. 구현 위치: `lib/handlers/mcp-handler.js#handleMcpPost`

처리 순서:
1. `method === "initialize"`: 헤더 검증 생략 (협상 이전 단계)
2. 헤더 없음: 스펙 fallback → `2025-03-26` 사용, WARNING 로그 기록 후 통과
3. 헤더 있음 + `SUPPORTED_PROTOCOL_VERSIONS`에 없음: HTTP 400 + `-32000 "Unsupported protocol version"`
4. 헤더 있음 + 세션 `negotiatedVersion`과 불일치: HTTP 400 + `-32000 "Protocol version mismatch"`
5. 통과: 기존 경로 진행

`negotiatedVersion` 저장: `dispatchJsonRpc` 완료 후 initialize 응답의 `result.protocolVersion`을 `streamableSessions.get(sessionId).negotiatedVersion`에 저장한다.

세션 데이터 `negotiatedVersion` 필드는 `lib/sessions.js#createStreamableSessionWithId`에서 `null`로 초기화된다.

메트릭: `mcp_protocol_version_rejected_total` (label: `version`)
