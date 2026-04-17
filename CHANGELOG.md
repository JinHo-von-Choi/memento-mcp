# Changelog

## [2.8.7] - 2026-04-17

### Fixed

- **`FragmentReader.getByIds` PostgreSQL "malformed array literal" 에러**: `key_id = ANY($3)` SQL에 단일 UUID 문자열을 그대로 바인딩하여 PG가 배열 파싱 시 실패했다. 호출 측이 `keyId`를 문자열로 전달하는 경우 배열로 래핑(`[keyId]`)하도록 수정. 영향 경로: `FragmentSearch.fetch`(missing IDs 조회), `RememberPostProcessor.linkedTo 소유권 확인`, `SessionLinker.autoLinkSessionFragments` — 간헐적 recall/remember/link 실패 원인이었다. (`lib/memory/FragmentReader.js`)

## [2.8.6] - 2026-04-17

### Changed

- **신뢰 redirect_uri에 한해 `/authorize` 자동 등록 허용**: `OAUTH_TRUSTED_ORIGINS` 기반 `isAllowedRedirectUri`가 true인 경우, `ALLOW_AUTO_DCR_REGISTER`와 무관하게 미등록 client_id도 `/authorize` 진입 시 자동 등록된다. 실질적 보안 경계는 v2.8.5의 `/token` `client_secret` 검증이므로 auto-register 자체는 안전하다. 바인딩되지 않은 토큰(API 키 미포함 시)은 `REJECT_NONAPIKEY_OAUTH=true` 정책에 의해 auth.js에서 거부된다. (`lib/handlers/oauth-handler.js`)
- **기본 신뢰 도메인 확인**: `claude.ai`, `chatgpt.com`, `platform.openai.com`, `copilot.microsoft.com`, `gemini.google.com` 5개 사전 내장. `OAUTH_TRUSTED_ORIGINS` env로 추가 가능. (`lib/config.js`)

### Impact

- claude.ai 외 ChatGPT/Copilot/Gemini 등 OAuth DCR-less 클라이언트도 사전 수동 등록 없이 즉시 연결 가능. 사용자가 client_id에 임의 문자열 + client_secret에 API 키를 입력하기만 하면 됨.
- 비신뢰 redirect_uri는 기존과 동일하게 `ALLOW_AUTO_DCR_REGISTER=false` 기본값에서 차단 (보안 유지).

## [2.8.5] - 2026-04-17

### Fixed

- **claude.ai OAuth 연결 실패 해결 (MCP 2025-06-18 spec 준수)**: claude.ai는 사용자가 connector UI에 입력한 `client_id`로 `/authorize`를 호출하고 `POST /token` body의 `client_secret`에 API 키를 전송한다. 다음 3개 수정으로 정상 tenant-격리된 OAuth 세션이 발급된다.

### Added

- **`/token#handleToken`의 `client_secret` → API 키 바인딩**: body의 `client_secret`을 `validateApiKeyFromDB`로 검증해 `tokenData.is_api_key=true` + `bound_key_id=keyId`를 주입. authorization_code와 refresh_token grant 모두 지원. 기존 auth.js의 bound_key_id 경로(v2.8.4)와 맞물려 keyId 격리 세션을 발급. (`lib/oauth.js`)
- **RFC 8707 `resource` 파라미터 저장**: `/authorize`와 `/token`에서 받은 `resource`를 codeData/tokenData에 보존하여 토큰 audience 추적. (`lib/oauth.js`, `lib/handlers/oauth-handler.js`)

### Changed

- **`token_endpoint_auth_methods_supported` 확장**: `["none"]` → `["none", "client_secret_post", "client_secret_basic"]`. claude.ai의 `client_secret_post` 호출과 AS metadata 일치. (`lib/oauth.js#getAuthServerMetadata`)
- **`bearer_methods_supported`에서 `query` 제거**: `["header", "query"]` → `["header"]`. MCP 스펙(2025-06-18 §249) "MUST NOT in URI query string" 준수. (`lib/oauth.js#getResourceMetadata`)
- **Protected Resource Metadata의 `resource` URI에 `/mcp` 경로 포함**: `${baseUrl}` → `${baseUrl}/mcp`. claude.ai가 `resource` 필드를 MCP 엔드포인트로 사용하여 이전에는 `/`(root)로 POST하다 404를 받던 문제 해결. (`lib/oauth.js#getResourceMetadata`)

## [2.8.4] - 2026-04-17

### Changed

- **`/register` Authorization Bearer 바인딩 전략 변경**: v2.8.3의 API 키 원문을 `client_id`로 사용하는 방식을 폐기. 원문 키가 URL·브라우저 히스토리·프록시 로그에 그대로 노출되는 문제를 해결. 이제 `client_id = "<name>_<keyIdHex8>"` (URL-safe 이름 + UUID 앞 8자 hex suffix)으로 등록한다. `validateRedirectUri` 엄격 검증이 기본 방어선이므로 보안 강도는 동일하게 유지된다. (`lib/handlers/oauth-handler.js`)

### Added

- **`client_name = "apikey:<keyId>"` 내부 바인딩 마커**: 스키마 변경 없이 `oauth_clients.client_name` 필드에 keyId UUID를 인코딩. `/authorize` 경로에서 이 마커를 파싱하여 `validateApiKeyById`로 tenant 격리 컨텍스트를 복원한다.
- **`validateApiKeyById(id)` 신규 함수** (`lib/admin/ApiKeyStore.js`): UUID 기반 API 키 조회. 원시 키 없이 keyId만으로 권한 정보(`keyId`, `name`, `groupKeyIds`, `permissions`, `defaultWorkspace`)를 반환.
- **`validateApiKeyFromDB` 반환 객체에 `name` 필드 추가**: 기존 반환 구조를 확장하여 `name` 필드를 포함. 하위 호환 유지.
- **`bound_key_id` 필드 전파**: `codeData` → `accessData`/`refreshData` → `validateAccessToken` 반환 객체까지 `bound_key_id`가 완전 전파. refresh_token 갱신 시에도 승계됨.
- **`validateAuthentication` bound_key_id 우선 경로** (`lib/auth.js`): OAuth 토큰의 `bound_key_id`가 있으면 `validateApiKeyById`로 1순위 처리. 기존 `is_api_key` 경로는 2순위로 유지 (v2.8.3 호환). non-API-key OAuth 거부는 3순위.
- **신규 메트릭** 3종:
  - `mcp_oauth_bound_client_registered_total`: name-based binding 등록 성공 횟수
  - `mcp_oauth_bound_client_authorized_total`: bound_key_id 경로로 /authorize 진입 횟수
  - `mcp_oauth_bound_client_authenticated_total`: bound_key_id 경로 인증 성공 횟수
- **신규 테스트** (`tests/unit/oauth-name-based-client-id.test.js`): 29개 케이스 (client_id 생성, client_name 마커, backward compat, bound_key_id 전파, refresh_token 승계, validateAuthentication 우선순위, 패턴 매칭 경계 케이스).

### Notes

- v2.8.3에서 전체 API 키 문자열을 `client_id`로 등록한 기존 Redis 토큰은 `bound_key_id=null`로 2순위 `is_api_key` 경로를 통해 정상 동작. backward compat 완전 보장.
- DB 스키마 변경 없음. migration 추가 불필요.

## [2.8.3] - 2026-04-17

### Fixed

- **DCR /register Authorization 헤더 기반 client_id 바인딩**: claude.ai 등 OAuth DCR 클라이언트가 `POST /register` 요청 시 `Authorization: Bearer <API 키>` 헤더로 보낸 API 키가 유효하면, 해당 API 키 문자열을 `client_id`로 사용하여 등록한다. 이후 `/authorize` 경로에서 `validateApiKeyFromDB`로 자연스럽게 `is_api_key=true` 경로를 타게 되어, Phase 2b의 non-API-key OAuth 거부 정책과 충돌 없이 정상 tenant 격리된 세션을 발급받는다. (`lib/handlers/oauth-handler.js`)

### Notes

- 별도 DB 스키마 변경 없음. 기존 `mmcp_*` 접두 client_id 플로우를 재활용한다.
- Authorization 헤더 없거나 유효하지 않은 토큰이면 기존 랜덤 client_id로 등록하되, 그 클라이언트가 발급받은 토큰은 auth.js의 `REJECT_NONAPIKEY_OAUTH=true` 정책에 의해 여전히 거부된다.

## [2.8.2] - 2026-04-17

### Security

- **non-API-key OAuth 클라이언트의 master 권한 취약점 차단**: `is_api_key=false` OAuth 토큰으로 인증 시도 시 `keyId=null` 세션이 생성되어 모든 파편에 master 권한으로 접근할 수 있었던 취약점 차단. `MCP_REJECT_NONAPIKEY_OAUTH=false`로만 기존 동작 복원 가능. (`lib/auth.js`)
- **OAuth auto-registration 기본 비활성화**: `/authorize`에서 미등록 `client_id`가 유효한 `redirect_uri`만 있으면 자동 등록되던 경로 차단. RFC 7591 `POST /register` 엔드포인트 경유 강제. `MCP_ALLOW_AUTO_DCR_REGISTER=true`로만 기존 동작 복원 가능. (`lib/handlers/oauth-handler.js`)

### Added

- **Spec compliance (세션 404)**: `sessionId` 있으나 Redis에 없고 인증도 실패한 경우, 또는 세션 expired 상태인 경우 HTTP 404 Not Found + JSON-RPC `-32000 "Session not found"` 반환. MCP 2025-06-18 스펙 요구사항 준수.
- **Security (Origin 검증)**: `MCP_STRICT_ORIGIN=true` 설정 시 허용 목록(`OAUTH_TRUSTED_ORIGINS` + `ALLOWED_ORIGINS` + 기본 신뢰 도메인) 외 Origin에서 온 요청을 403으로 거부. DNS rebinding 공격 방어. 기본값 `false` (opt-in, 기존 동작 유지).
- **Spec compliance (Protocol-Version)**: initialize 이후 모든 요청에서 `MCP-Protocol-Version` 헤더 검증. 헤더 없으면 2025-03-26 fallback, 미지원 버전이면 400, 세션 negotiatedVersion과 불일치하면 400. initialize 요청은 검증 생략.
- **세션 `negotiatedVersion` 필드**: initialize 응답 완료 시 협상된 프로토콜 버전을 세션 데이터에 저장. 이후 요청의 MCP-Protocol-Version 대조에 활용.
- **`MCP_REJECT_NONAPIKEY_OAUTH` 환경변수** (기본 `true`): non-API-key OAuth 토큰 거부 제어. `false` 설정 시 하위 호환 모드.
- **`MCP_ALLOW_AUTO_DCR_REGISTER` 환경변수** (기본 `false`): OAuth 자동 클라이언트 등록 허용 제어. `true` 설정 시 기존 자동 등록 동작.
- **New env**: `MCP_STRICT_ORIGIN` (기본 `false`).
- **New metrics**: `mcp_session_404_total`, `mcp_origin_rejected_total` (label: `origin`), `mcp_protocol_version_rejected_total` (label: `version`), `mcp_oauth_nonapikey_rejected_total`, `mcp_oauth_auto_register_blocked_total`.

## [2.8.1] - 2026-04-17

### Added

- **세션 ID 보존 복구**: `lib/sessions.js`에 `createStreamableSessionWithId(sessionId, ...)` 추가. auto-recovery 경로에서 `crypto.randomUUID()` 대신 클라이언트가 보낸 원본 `sessionId`로 세션을 재생성하여 데이터 연속성 보장.
- **keyId 교차 검증 (403)**: 세션 복구 시 Redis의 기존 `keyId`와 재인증된 `keyId`가 불일치하면 403 Forbidden + JSON-RPC `-32000 "Forbidden"` 반환. `recordTenantIsolationBlocked("session_recover_keyid_mismatch")` 호출.
- **Redis 세션 저장 실패 메트릭** (`mcp_redis_session_save_failure_total`, label: `operation`): Redis saveSession catch 경로에서 자동 집계.
- **세션 복구 결과 메트릭** (`mcp_session_recovery_total`, label: `result` = `same_id_success` | `keyid_mismatch` | `not_found` | `new_session`): auto-recovery 분기 전체 관측.
- **세션 idle reflect 메트릭** (`mcp_session_idle_reflect_total`): 24h idle autoReflect 실행 시 카운트.
- **MCP_IDLE_REFLECT_HOURS 환경변수** (기본 24): `cleanupExpiredSessions`에서 이 시간 이상 비활성 세션에 중간 autoReflect 실행.
- **세션 객체 `lastReflectedAt` 필드**: 마지막 reflect 시각 추적. idle reflect 중복 실행 방지.

### Fixed

- **Heartbeat 연속 실패 경로 autoReflect 누락**: `lib/sessions.js`의 heartbeat interval에서 `hbFailures >= SSE_MAX_HEARTBEAT_FAILURES` 시 `session.close()` 직접 호출 대신 `closeStreamableSession(sessionId)`를 경유하도록 수정. 세션 종료 시 autoReflect가 반드시 실행됨.

## [2.8.0] - 2026-04-16

### Added — Symbolic Memory Layer (opt-in, 기본 전면 비활성)

v2.7.0 확률론적 검색(FragmentSearch/RRF/Reranker/SpreadingActivation) 위에 feature-flag 기반 심볼릭 검증 계층을 추가. 기존 경로 대체 없음. 검증/해설/advisory warning만 담당. 모든 `MEMENTO_SYMBOLIC_*` 플래그 기본 false → 프로덕션 경로 영향 0건.

**Phase 0: Foundation**
- `lib/symbolic/` 9개 core 모듈 + `lib/symbolic/rules/v1/` 5개 규칙 파일 (SymbolicOrchestrator, ClaimStore, ClaimExtractor, ClaimConflictDetector, LinkIntegrityChecker, ExplanationBuilder, CbrEligibility, PolicyRules, SymbolicMetrics)
- `config/symbolic.js`: Object.freeze 12개 환경변수 (9 boolean 플래그 + `MEMENTO_SYMBOLIC_RULE_VERSION` + `MEMENTO_SYMBOLIC_TIMEOUT_MS` + `MEMENTO_SYMBOLIC_MAX_CANDIDATES`)
- `migration-032-fragment-claims.sql`: `fragment_claims` 테이블 + v2.7.0 migration-031 content-hash 테넌트 격리 패턴 복제 (master NULL / tenant 분리 partial unique 2개) + `validation_warnings` JSONB
- `migration-033-symbolic-hard-gate.sql`: `api_keys.symbolic_hard_gate BOOLEAN DEFAULT false` — 키 단위 opt-in
- `scripts/benchmark-hot-path.js` + `scripts/baseline-v27.json` — 회귀 감시 baseline
- Rollback 파일은 `rollback-migration-NNN-*.sql` 네이밍 (migrate.js auto-pickup glob 회피)

**Phase 1: Shadow Mode + Claim Backfill**
- `RememberPostProcessor.run()` 8단계 `_extractSymbolicClaims`: fire-and-forget. TENANT_ISOLATION_VIOLATION catch 후 `recordGateBlock` + swallow
- `FragmentSearch.search` 라인 88 shadow hook (`observeLatency`)
- `scripts/backfill-claims.js`: 키셋 페이지네이션 + 8 CLI 옵션 (`--batch-size`, `--rate-limit-ms`, `--tenant-key`, `--limit`, `--min-confidence`, `--dry-run`, `--verbose` 등)

**Phase 2: Explainability (첫 사용자 가치)**
- `ExplanationBuilder.annotate(fragments, searchContext)` — 불변 복사 + 싱글톤/DI 양립
- `rules/v1/explain.js`: 6 reason codes (`direct_keyword_match`, `semantic_similarity`, `graph_neighbor_1hop`, `temporal_proximity`, `case_cohort_member`, `recent_activity_ema`), 각 fragment 최대 3개
- `FragmentSearch.search` hook chain: shadow → explain → CBR 순서

**Phase 3: Advisory Link Integrity + Polarity Conflict**
- `LinkIntegrityChecker.checkCycle`: `sessionLinker.wouldCreateCycle` 재사용 (Phase 0.5에서 4-arg 전파 완료). DIRECTIONAL_RELATIONS {caused_by, resolved_by, superseded_by, preceded_by} 외엔 early return
- Caller-side advisory guards 4곳: ConflictResolver.autoLinkOnRemember / .supersede, RememberPostProcessor linked_to Promise.all / _proactiveRecall
- `ClaimConflictDetector`: `ClaimStore.findPolarityConflicts` + severity heuristic (1→low, 2-3→medium, 4+→high) + `memento_symbolic_warning_total` 기록
- `ConflictResolver.checkAssertionConsistency`: 기존 Jaccard 파이프라인 보존 + symbolic polarity 병기. supersedeCandidates 병합 + `validationWarnings` 반환 필드 신설

**Phase 4: Policy Rules + Soft Gating**
- `PolicyRules` 5 predicate (순수 동기, AutoReflect 5원칙과 영역 분리):
  - `decisionHasRationale` (linked_to ≥ 2 OR 근거 키워드)
  - `errorHasResolutionPath` (cause/fix 키워드 OR resolution_status)
  - `procedureHasStepMarkers` (번호/단계 마커)
  - `caseIdHasResolutionStatus` (case_id 있으면 resolution_status 필수)
  - `assertionNotContradictory`
- `MemoryManager.remember` store.insert 직전 훅: violations → `fragment.validation_warnings` 누적, block 금지 (soft gate)
- `migration-033`: `api_keys.symbolic_hard_gate BOOLEAN DEFAULT false` — 키 단위 opt-in hard gate. true인 키에서 PolicyRules violations 발생 시 `SymbolicPolicyViolationError` throw, JSON-RPC 에러 코드 `-32003`, `data.violations` 배열로 위반 rule 이름 전달. 마스터 키(keyId=NULL)는 대상 제외. ApiKeyStore 30초 TTL 캐시 경유로 매 요청 SELECT 회피. DB 조회 실패 시 fail-open(false)으로 폴백

**Phase 5: CBR Constraint Filtering**
- `CbrEligibility` 4 제약 (`tenant_match`, `has_case_id`, `not_quarantine`, `resolved_state`). Prolog 미도입(옵션 A JS-only)
- FragmentSearch `case_mode` 경로 (`sq.caseId` 주입 시) 필터 적용
- SearchParamAdaptor 학습 신호 보호: `rawResultCount`는 pre-filter로 `recordOutcome`, post-filter 차단은 `memento_symbolic_gate_blocked_total{phase=cbr}`로 별도 기록

**Phase 6: ProactiveRecall Gating**
- `RememberPostProcessor._proactiveRecall` overlap ≥ 0.5 분기 내 `_proactiveGateCheck` 삽입
- `rules/v1/proactive-gate.js`: 비용 순 검사 (invalid_target → quarantine → cohort_mismatch → polarity_conflict). detector throw는 fail-open

**Observability**
- Prometheus 메트릭 4종: `memento_symbolic_claim_total`, `memento_symbolic_warning_total`, `memento_symbolic_gate_blocked_total`, `memento_symbolic_latency_seconds`

### Added — LLM Provider Abstraction + Fallback Chain

기존 Gemini CLI 단일 경로였던 5개 caller(AutoReflect, MorphemeIndex, ConsolidatorGC, ContradictionDetector, MemoryEvaluator)를 13 provider fallback chain으로 확장. Gemini CLI 실패/미설치 환경에서도 자동 fallback으로 기능 유지.

**지원 Provider 13종**
- Gemini CLI (기본, 로컬)
- Anthropic, OpenAI, Google Gemini API, Groq, OpenRouter, xAI, Ollama, vLLM, DeepSeek, Mistral, Cohere, ZAI (GLM)

**환경변수**
- `LLM_PRIMARY` — 주 provider 이름 (기본 `gemini-cli`)
- `LLM_FALLBACKS` — JSON 배열. 각 원소 `{provider, apiKey, model, baseUrl?, timeoutMs?, extraHeaders?}`
- `LLM_CB_FAILURE_THRESHOLD` / `LLM_CB_OPEN_DURATION_MS` / `LLM_CB_FAILURE_WINDOW_MS` — Circuit breaker 튜닝
- `LLM_TOKEN_BUDGET_INPUT` / `LLM_TOKEN_BUDGET_OUTPUT` — 선택적 token cap

**설정 예시**
```bash
LLM_PRIMARY=gemini-cli
LLM_FALLBACKS='[
  {"provider":"anthropic","apiKey":"sk-ant-...","model":"claude-opus-4-6"},
  {"provider":"openai","apiKey":"sk-...","model":"gpt-4o-mini"},
  {"provider":"groq","apiKey":"gsk_...","model":"llama-3.3-70b-versatile"}
]'
```

**핵심 동작**
- Fallback chain: primary → JSON 순서대로 순차 시도. 성공 시 즉시 반환
- Circuit breaker: 5회 연속 실패 시 해당 provider 60초 skip (Redis 또는 in-memory, REDIS_ENABLED 자동 분기)
- Prompt redaction: 모든 provider 호출 전 Winston REDACT_PATTERNS 재사용하여 API 키/토큰/세션 쿠키 자동 마스킹
- Token usage: Prometheus `memento_llm_token_usage_total{provider, direction}` 카운터로 집계
- Fatal error (사용자 취소, 명백한 설정 오류)는 즉시 throw. Timeout/429/5xx/parse error는 다음 provider 폴백

**Observability (Prometheus)**
- `memento_llm_provider_calls_total{provider, outcome}`
- `memento_llm_provider_latency_ms{provider}` histogram
- `memento_llm_fallback_triggered_total{primary, fallback}`
- `memento_llm_token_usage_total{provider, direction}`

**Backward compatibility**
- 기존 `geminiCLIJson`/`isGeminiCLIAvailable` API는 thin shim으로 유지 (5 caller 수정 0건)
- LLM env var 미설정 시 Gemini CLI legacy 경로 그대로 사용 (회귀 0건)
- 임베딩 provider(`EMBEDDING_PROVIDER`) 경로는 완전 별개로 유지
- `runGeminiCLI` 시그니처 불변 (GeminiCliProvider 내부에서 사용)

**보안 주의**
- 외부 LLM 사용 시 사용자 파편 content가 해당 업체 서버로 전송됨
- 패턴 기반 redaction 적용: `sk-...`, `sk-ant-...`, `gsk_...`, `Bearer ...`, `mmcp_...`, `mmcp_session=...` 등 자동 마스킹
- 도메인 특화 PII(이름, 주소 등)는 마스킹 대상 아님 — 운영자가 프롬프트 민감도 판단 필요
- 외부 provider 차단: `LLM_FALLBACKS`에 해당 provider를 포함하지 않으면 됨

### Security — Tenant Isolation Hardening

- **Phase 0.5: SessionLinker.wouldCreateCycle keyId 4-arg 전파**: v2.7.0 9260ff2 tenant isolation 14건 수정이 놓친 사각지대 봉인 — API 키 사용자 컨텍스트의 cycle 탐색이 cross-tenant fragment를 경유하던 결함 제거. `store.isReachable` 4-arg 시그니처 확장. `SessionLinker.autoLinkSessionFragments`, `ReflectProcessor:222`, `MemoryManager._autoLinkSessionFragments/_wouldCreateCycle` wrapper 전수 수정
- **회귀 가드**: `tests/unit/tenant-isolation.test.js` 신규 6건 (cross-tenant cycle 차단 grep 기반)

### Fixed

- `migration-032` `fragment_id` 타입 정정: UUID → TEXT (fragments.id 타입 일치, 4e1d003)
- dead indirection 정리: migration-033 rollback 파일 네이밍 회피 (9678392)
- **Phase 4 validation_warnings 응답 누락 수정**: `MemoryManager.remember()` return shape에 `validation_warnings: string[]` (rule 이름 배열) 추가. violations 없을 경우 필드 자체 생략 (e960baa)
- **fragments.validation_warnings DB 영속화 수정**: `FragmentWriter.insert` INSERT 컬럼 목록에 `validation_warnings` 추가, `$25::jsonb` 파라미터로 rule 이름 string[] JSON 저장. embedding placeholder $25 → $26 이동 (8a7efe9)
- **tool_recall explanations passthrough 수정**: `tool_recall` 응답 fragment shape에 `explanations` 필드 추가 (`Array.isArray && length > 0` 조건 선택적 포함). `FragmentSearch.search`가 `ExplanationBuilder.annotate`로 주입한 값 passthrough 완성 (aebd16e)
- **Hard gate 에러 경로 수정**: `tool_remember` catch 블록에 `SymbolicPolicyViolationError` 전파 분기 추가. JSON-RPC 최상위 catch가 `-32003` 프로토콜 에러로 매핑 (`data.violations: string[]` 포함). 기존 응답 `{success: false, code: SYMBOLIC_POLICY_VIOLATION}`은 도구 에러(MCP 에러)이며 프로토콜 에러 아님 — 수정으로 실측 동작이 CHANGELOG/SKILL.md 기술과 일치 (aebd16e)
- **tool_link advisory cycle check 배선**: `tool_link`에 `mgr.linkChecker.checkCycle` advisory 호출 추가. `hasCycle=true` 시 warn 로그 + `symbolicMetrics.recordWarning` 자동 발동. 링크 차단 없음 (fail-open) (aebd16e)
- **Prometheus /metrics auth 요구사항 문서화**: Bearer 헤더 없이 GET /metrics 호출 시 401 반환 — 의도된 보안 동작. 운영 문서(`docs/operations/symbolic-hard-gate.md`)에 한 줄 명시 (d6f52b0)

### Migration Guide (v2.7.0 → v2.8.0)

**기본 시나리오 (회귀 0건 보장)**
- `npm run migrate` 실행: migration-032, migration-033 적용 — 스키마 확장만 수행, 기본 플래그 false 상태 유지 → 기존 동작과 완전 동일

**Symbolic 계층 단계적 활성화 순서 (권장)**
1. `MEMENTO_SYMBOLIC_ENABLED=true` — 마스터 킬 스위치 해제
2. `MEMENTO_SYMBOLIC_SHADOW=true` + `MEMENTO_SYMBOLIC_CLAIM_EXTRACTION=true` — Phase 1 shadow mode로 claim 축적 확인
3. `scripts/backfill-claims.js` 실행으로 기존 파편 claim 백필 (옵션: `--dry-run` 선행)
4. `MEMENTO_SYMBOLIC_EXPLAIN=true` — Phase 2 recall 응답 explanation 필드 공개
5. `MEMENTO_SYMBOLIC_LINK_CHECK=true` + `MEMENTO_SYMBOLIC_POLARITY_CONFLICT=true` — Phase 3 advisory warning
6. `MEMENTO_SYMBOLIC_POLICY_RULES=true` — Phase 4 soft gating (validation_warnings 누적만, block 없음)
7. `MEMENTO_SYMBOLIC_CBR_FILTER=true` + `MEMENTO_SYMBOLIC_PROACTIVE_GATE=true` — Phase 5/6 제약 필터
8. 필요 시 개별 API 키에 `api_keys.symbolic_hard_gate=true` 설정으로 hard gate 전환
9. 필요 시 `UPDATE agent_memory.api_keys SET symbolic_hard_gate=true WHERE id=<uuid>`로 특정 키를 hard gate로 전환. 캐시 무효화는 최대 30초 후 자동 반영

**신규 응답 필드**
- `remember` 응답: `validation_warnings: string[]` — rule 이름 배열 (e.g. `["decisionHasRationale"]`). violations 없으면 필드 생략. hard gate 위반 시 필드 대신 JSON-RPC `-32003` 에러 반환.
- `recall` 응답 fragment: `explanations: [{code: string, detail: string, ruleVersion: string}]` — 파편이 검색된 이유 (MEMENTO_SYMBOLIC_EXPLAIN=true 시). 없으면 필드 생략.
- Hard gate 에러: `{"error": {"code": -32003, "message": "...", "data": {"violations": ["ruleName", ...], "fragmentType": "..."}}}` — MCP 도구 에러가 아닌 JSON-RPC 프로토콜 레벨 에러.

## [2.7.0] - 2026-04-10

### Security (Breaking Changes)
- **Fail-closed authentication**: `MEMENTO_ACCESS_KEY` 미설정 시 서버 기동 거부. `MEMENTO_AUTH_DISABLED=true` 명시 opt-in으로만 우회. (78e59d1)
- **OAuth silent consent 제거**: 모든 authorize 요청은 consent 화면 경유 필수. `OAUTH_TRUSTED_ORIGINS` 기본값 빈 배열. (bcef71b)
- **CORS fail-closed**: `ALLOWED_ORIGINS`/`ADMIN_ALLOWED_ORIGINS` 미설정 시 same-origin만 허용 (이전: 모든 origin 허용). (517c76a)
- **RBAC default-deny**: 알려지지 않은 도구는 `{ allowed: false }` 반환. 18개 도구 전체 맵핑 완료. (d97738a)
- **content_hash 테넌트 격리**: 전역 UNIQUE 인덱스 → `(key_id, content_hash)` partial unique 2개로 전환. cross-tenant ON CONFLICT 경로 차단. migration-031 필요. (83859fd, aed5a55)
- **_keyId 클라이언트 위조 방어**: tools/call 진입부에서 클라이언트 전송 `_keyId/_groupKeyIds` 무조건 delete 후 서버 인증값으로 재주입. (236c7d4)
- **FragmentReader.getById 시그니처 확장**: `(id, agentId)` → `(id, agentId, keyId, groupKeyIds)` SQL 레벨 key_id 필터 추가. 모든 호출부 전수 수정. (e1555ed)
- **GraphLinker/ContradictionDetector key_id 격리**: supersession/contradiction 쿼리에 cross-tenant 차단. (92589ad, aa48a24)
- **LinkStore/CaseEventStore/RememberPostProcessor key_id 필터**: traversal·소유권·증거 쿼리 격리. (9260ff2, fd8dbdc, bde6341)
- **GraphNeighborSearch**: `key_id IS NULL` master 노출 제거 + `::int[]` → `::text[]` 타입 수정. (1981331)
- **OAuth access token TTL**: `OAUTH_TOKEN_TTL_SECONDS` (기본 2592000 = SESSION_TTL_MINUTES*60, 30일) + `OAUTH_REFRESH_TTL_SECONDS` (기본 5184000, 60일). 세션 TTL과 연동. (24d38ce)
- **OAuth/Admin rate limit**: `/register`, `/token`, `/authorize`, `/admin/auth`, `/admin/keys`, `/admin/import`에 IP 기반 rate limit + body cap 적용. (fe009cd)
- **TemporalLinker groupKeyIds 수용**: cross-tenant temporal 링크 생성 차단. (2780860)

### Fixed
- **그룹 조회 실패 4건 수정**:
  - `FragmentReader.searchByKeywords/searchByTopic/searchBySemantic` SELECT 절에 `key_id` 컬럼 추가 (d65e656)
  - 세션 복원 시 `groupKeyIds` null 폴백 — `ApiKeyStore.getGroupKeyIds()` 재조회 (4117278, 5291b4f)
  - `FragmentIndex.keyNs` 배열 처리 — per-namespace SUNION으로 L1 캐시 회복 (ae3a6e6)
  - `search_param_thresholds.key_id` INTEGER → TEXT 마이그레이션 (2661394, 8f693b6)
- **admin-overview-render.test.js ESM 호환**: `AdminEsmLoadError` sentinel + `describe.skip` (0b85384)

### Added
- **OpenAPI 3.1.0**: `GET /openapi.json` — master=35 paths 전체, API key=권한 필터링. `ENABLE_OPENAPI=true`로 활성화. (dc39ca4)
- **AutoReflect 개선**: `_shouldSkipReflect` (명시적 파편 세션 skip), `_buildGeminiPrompt` (자기완결성 5원칙 주입), `_reflectMinimal` 제거. (7834f4e~d7fa815)
- **remember/reflect 스키마 강화**: 자기완결성 5대 기준(대명사 해소, 구체 엔티티/수치, 메타 금지, 원자성, 인과 결합 예외) + 6개월 판단 테스트. (eadcca1)
- **거부 경로 Prometheus 카운터 4종**: `memento_auth_denied_total`, `memento_cors_denied_total`, `memento_rbac_denied_total`, `memento_tenant_isolation_blocked_total`. (a35d185)
- **Winston 로그 redactor**: Authorization/API 키/세션 토큰/OAuth 코드/content 마스킹. (f589536)
- **SSE 연결 안정성 강화**:
  - Heartbeat failure detection: `SSE_MAX_HEARTBEAT_FAILURES`(기본 3) 연속 실패 시 세션 자동 종료. write backpressure 및 예외 감지
  - Proxy 호환성: `X-Accel-Buffering: no` 헤더로 nginx/reverse proxy SSE 버퍼링 방지
  - `sseWrite()` atomic write + boolean 반환으로 write 실패 graceful 처리
  - Server socket tuning: `keepAliveTimeout=0`, `headersTimeout=0`, TCP keep-alive 60s, `TCP_NODELAY`
  - 환경변수: `SSE_HEARTBEAT_INTERVAL_MS`(25000), `SSE_MAX_HEARTBEAT_FAILURES`(3), `SSE_RETRY_MS`(5000)

### Migration Guide (v2.6.0 → v2.7.0)
- `MEMENTO_ACCESS_KEY` 필수 — 미설정 시 서버 기동 거부. 개발용: `MEMENTO_AUTH_DISABLED=true`
- `ALLOWED_ORIGINS` 미설정 시 same-origin만 허용. 기존 cross-origin 클라이언트는 명시적 설정 필요
- OAuth 기존 토큰은 최대 30일 TTL까지 유효. 갱신 시 consent 화면 1회 경유
- `npm run migrate` 실행: migration-030 (search_param_thresholds 타입), migration-031 (content_hash 격리)
- `OAUTH_TOKEN_TTL_SECONDS` (기본 2592000, SESSION_TTL_MINUTES*60) / `OAUTH_REFRESH_TTL_SECONDS` (기본 5184000) 환경변수

## [2.6.0] - 2026-04-07

### Added
- **CBR (Case-Based Reasoning)**: `recall(caseMode=true)` — 유사 파편에서 case_id를 추출하여 (goal, events, outcome, resolution_status) 트리플로 반환. 과거 해결 사례 재활용. CaseRecall 모듈 신규 (`lib/memory/CaseRecall.js`)
  - 가드레일: HARD_MAX_CASES=10, MAX_EVENTS_PER_CASE=20, MAX_EVENT_SUMMARY_LEN=120 (~24KB 상한)
  - `maxCases` 파라미터 (기본 5, 상한 10)
- **depth 필터**: `recall(depth="high-level"|"detail"|"tool-level")` — Planner/Executor 역할별 검색 깊이 제어
  - high-level: decision/episode만 반환 (고수준 계획 참조)
  - tool-level: procedure/error/fact만 반환 (구체적 실행 절차)
- `get_skill_guide(section="cbr")`: SKILL.md CBR 섹션 매핑 추가

### Documentation
- SKILL.md: v2.5.7 현행화 — CBR 활용 가이드, depth 전략, recall 파라미터 3개, 트리거 3개 추가
- aiInstructions: caseMode/depth/maxCases 사용 예시 추가
- api-reference.md: recall 도구 섹션 + caseMode 응답 JSON 예시
- architecture.md: CBR/Reconsolidation/SpreadingActivation/Security/ESM/Graph 6개 섹션 추가
- README.md: v2.5.7 기능 목록 갱신

## [2.5.7] - 2026-04-07

### Security
- **Tenant Isolation**: `key_id IS NULL OR key_id = $N` 패턴 14건 전수 제거 — API 키 사용자가 마스터(key_id=NULL) 파편에 접근/수정/삭제 가능했던 취약점 수정
  - FragmentWriter: deleteMany, patchAssertion
  - MemoryManager: toolFeedback EMA 업데이트
  - CaseEventStore: getByCase, getBySession
  - HistoryReconstructor: _fetchTimelineParameterized
  - CaseRewardBackprop: backprop (TEXT 타입 불일치 동시 해결)
  - ConflictResolver, SpreadingActivation, reconstruct.js 추가 발견 3건
- **Cross-tenant write 차단**: findCaseIdBySessionTopic/findErrorFragmentsBySessionTopic/updateCaseId/touchLinked에 keyId 격리 필터 추가

### Added
- `tests/unit/tenant-isolation.test.js`: grep 기반 회귀 방지 가드 — `key_id IS NULL OR key_id` 패턴 자동 탐지

### Refactored
- **Admin UI ESM 모듈화**: admin.js 4,860줄 → 58줄 엔트리포인트 + 13개 도메인별 ESM 모듈 (번들러 없이 브라우저 네이티브 ESM)
  - modules/: state, api, ui, format, auth, layout, overview, keys, groups, sessions, graph, logs, memory
  - index.html: `<script type="module">` 전환

### Performance
- **Knowledge Graph 렌더링 최적화**:
  - 시뮬레이션/드래그 중 SVG blur 필터 비활성화, 안정화 후 복원 (~70% 프레임 비용 감소)
  - 인접맵(adjMap) 사전 구축: hover 시 O(L) → O(1) 링크 하이라이트
  - 위성 rAF 제어: 시뮬레이션 중 정지, document.hidden 시 중단
  - tick 핸들러 경량화: ring rotate 1회 적용, alphaDecay 0.05 수렴 가속
- **행성 크기 ±15% 결정적 난수**: fragRng 기반 nodeR jitter 적용

## [2.5.6] - 2026-04-07

### Added
- **ProactiveRecall**: remember() 호출 시 키워드 오버랩(>=50%) 기반 유사 파편 자동 `related_to` 링크 생성. RememberPostProcessor fire-and-forget 단계로 추가. (`b90cc83`)
- **CaseRewardBackprop**: `verification_passed` / `verification_failed` case 이벤트 시 증거 파편 importance를 DB 원자적 UPDATE로 역전파. +0.15(passed, quality_verified=true) / -0.10(failed). CaseEventStore.append() fire-and-forget 훅. (`c15a03c`, `75ef107`)
- **SearchParamAdaptor**: key_id x query_type x hour 조합별 minSimilarity 온라인 학습. 단일 원자적 UPSERT (TOCTOU-free). 대칭 학습률 -0.01/+0.01, 범위 [0.10, 0.60], MIN_SAMPLE=50. FragmentSearch._searchL3()에 통합. (`4271a3f`, `86bd4db`)
- **migration-029**: `agent_memory.search_param_thresholds` 테이블 (key_id NOT NULL DEFAULT -1, UNIQUE(key_id, query_type, hour_bucket))

### Fixed
- CaseRewardBackprop: fragments 테이블에 `updated_at` 컬럼 없음 -> SET 절에서 제거 (`75ef107`)

## [2.5.3] - 2026-04-06

### Fixed
- `search_events.session_id` 미기록: `MemoryManager.recall()` → `FragmentSearch.search()` 호출 시 sessionId 누락 수정
- `search_events` 빈 `search_path` 326건: non-text 검색 경로에서 L2 결과 0건일 때 searchPath 미기록 수정
- `SearchEventRecorder` INSERT에서 `used_rrf`/`rrf_used` 동일값 이중 삽입 수정

### Removed
- `search_events.rrf_used` 컬럼 제거 — `used_rrf`로 단일화 (migration-028)
- `fragments.superseded_by` dead 컬럼 제거 — `fragment_links` 기반으로 완전 대체 (migration-028)

### Changed
- migration-028+029+031 → `migration-028-v253-improvements.sql` 단일 파일로 통합

## [2.5.2] - 2026-04-05

### Refactored
- `MemoryManager.js` 1,790줄 → 904줄 (-49.5%):
  - `ContextBuilder` 추출 (context 330줄 → build() 위임)
  - `ReflectProcessor` 추출 (reflect 220줄 + _buildEpisodeContext + _saveTaskFeedback)
  - `BatchRememberProcessor` 추출 (batchRemember 247줄, Phase A/B/C 구조 유지)
  - `QuotaChecker` 추출 (API 키 파편 할당량 검사)
  - `RememberPostProcessor` 추출 (remember 후처리 파이프라인)
- `http-handlers.js` 864줄 → 21줄 re-export:
  - `lib/handlers/mcp-handler.js` (Streamable HTTP)
  - `lib/handlers/sse-handler.js` (Legacy SSE)
  - `lib/handlers/health-handler.js` (Health/Metrics)
  - `lib/handlers/oauth-handler.js` (OAuth 2.1)
  - `lib/handlers/_common.js` (공통 유틸리티)

### Added
- `EmbeddingCache`: 쿼리 임베딩 Redis 캐시 (키: `emb:q:{sha256}`, TTL 1h, Float32Array 바이너리)
- `migration-028`: 복합 인덱스 `(agent_id, topic, created_at DESC)` + `(key_id, agent_id, importance DESC) WHERE valid_to IS NULL`
- `config/validate-memory-config.js`: 메모리 설정 런타임 검증
- `tests/README.md`: 테스트 계층 규칙 문서

### Fixed
- `ReflectProcessor`: errors_resolved 파편에 `resolution_status='resolved'` 자동 세팅
- `ReflectProcessor`: open_questions 파편에 `resolution_status='open'` 자동 세팅
- `ReflectProcessor`: 모든 reflect 생성 파편에 `session_id` 전파

### Performance
- `ConsolidatorGC.compressOldFragments()`: KNN N+1 쿼리 → BATCH_SIZE=20 Promise.all 병렬
- `FragmentSearch._searchL3()`: EmbeddingCache 적용으로 반복 쿼리 임베딩 생성 제거

## [2.5.1] - 2026-04-04

### Added
- `context()`: `_memento_hint` 필드 추가 — AI 능동 행동 유도 (active_errors / empty_context signal)
- `context(structured=true)`: `rankedInjection` 필드 추가 — anchor 고정 + 복합 점수(importance×0.6 + ema_activation×0.4) 정렬 슬라이스
- `tool_recall`: `_memento_hint` 필드 추가 — no_results / stale_results / consider_context signal
- `config/memory.js`: `rankWeights` 설정 추가 (importance: 0.6, ema_activation: 0.4)
- `SKILL.md`: curl 직접 호출 섹션, 능동 활용 트리거 섹션, 안티패턴 섹션 추가
- `lib/tools/memory-schemas.js`: `get_skill_guide` section 옵션에 `triggers`, `antipatterns` 추가
- `lib/tools/memory.js`: SKILL_SECTIONS에 `triggers`, `antipatterns` regex 추가

### Fixed
- `oauth.js`: `issuer` 및 `authorization_servers` URL에서 `/oauth` 서픽스 제거 — RFC 8414 준수
- `oauth.js`: 등록되지 않은 client_id + trusted redirect_uri 조합 허용 (anonymous client) — claude.ai 등 DCR 없이 접근하는 클라이언트 지원
- `server.js`: `/.well-known/oauth-authorization-server` 경로 추가 (기존 `/oauth` 서픽스 경로 유지)
- `lib/tools/memory.js`: `experiential` SKILL_SECTIONS regex가 이후 섹션을 삼키는 버그 수정

## [2.5.0] - 2026-04-03

### Fixed (보안 / 정확성)
- `FragmentReader.getById/getByIds/searchBySource`: `valid_to IS NULL` 필터 누락 — superseded 파편이 조회에 노출되는 버그 수정
- `FragmentIndex.warmup()`: `valid_to IS NULL` 조건 추가, 만료 파편이 L1 캐시를 오염시키는 버그 수정
- `handleMcpDelete()`: session 삭제 시 소유자 검증 누락 수정 — 미인증 401, 타 키 삭제 시도 403 반환, master key bypass
- `GraphNeighborSearch`: keyId 타입 정규화 (`Array.isArray` guard), `key_id = ANY($4::int[])` 타입 안전성 수정
- `TemporalLinker`: `keyId = ANY($n)` → `keyId = $n` 단일 정수 등치로 수정
- `CaseEventStore.append()`: `sequence_no` 할당에 `FOR UPDATE` 잠금 추가, 동시 INSERT 경쟁 조건 방지
- `MemoryManager.toolFeedback()`: `keyId` 격리 추가, EMA 업데이트가 cross-key로 적용되는 버그 수정
- `MemoryManager.amend()`: `groupKeyIds` 소유권 검증 추가

### Fixed (데이터 정합성)
- `MemoryManager.batchRemember()`: INSERT SQL 8개 컬럼 누락 수정 (`context_summary`, `session_id`, `case_id`, `goal`, `outcome`, `phase`, `resolution_status`, `assertion_status`)
- `MemoryManager.batchRemember()` TOCTOU: quota 체크 트랜잭션과 INSERT 트랜잭션 분리로 인한 경쟁 조건 완화 — INSERT 트랜잭션 내 `FOR UPDATE` 재잠금 + 잔여 슬롯 재확인

### Fixed (성능 / N+1)
- `FragmentSearch._tryHotCache`: `for await` → `Promise.all`, Redis 직렬 호출 병렬화
- `FragmentSearch._cacheFragments`: `for await` → `Promise.all`
- `FragmentIndex.warmup()`: 순차 indexing → 50개 chunk `Promise.all` 병렬화
- `MemoryManager.reflect()`: `Promise.allSettled` 병렬 insert 도입
- `MemoryManager.context()`: `for await` → `Promise.all`
- `MemoryManager.forget(topic)`: Redis deindex `Promise.all` + 단일 `deleteMany()` 일괄 삭제
- `tool_recall includeContext`: O(N·K) 순차 `searchBySource` → 세션 ID dedup + `Promise.all` + Map 조회 O(K)

### Fixed (세션)
- `sessions.js validateStreamableSession()`: Redis 복원 시 TTL 갱신 및 `lastAccessedAt`/`expiresAt` 재설정 누락 수정 — 서버 재시작 후 복원된 세션이 즉시 만료되는 버그 수정

### Added
- `ReconsolidationEngine.js`: fragment_links weight/confidence 동적 갱신 엔진
  - `reconsolidate(linkId, action, opts)`: reinforce/decay/quarantine/restore/soft_delete 5종 action, 단일 트랜잭션
  - `quarantineAdjacentLinks(fromId, toId, keyId)`: contradicts 감지 시 인접 related/temporal 링크 soft quarantine
  - 동일 link 60초 내 재감쇠 방지 rate-limit (`lastDecayAt` Map)
- `EpisodeContinuityService.js`: reflect() 후 episode 파편 간 preceded_by 엣지 자동 생성
  - `linkEpisodeMilestone(episodeFragmentId, agentId, keyId, sessionId)`: idempotency_key 기반 중복 방지
  - `lastEventByAgent` in-memory 캐시로 직전 이벤트 조회 쿼리 절감
- `SpreadingActivation.js`: contextText 기반 비동기 활성화 전파 (ACT-R 모델)
  - `activateByContext(contextText, agentId, keyId, sessionId)`: 키워드 추출 → 1-hop 그래프 확장 → activation_score boost
  - `activationQueue` 비동기 큐 + `drainQueue()`: DB pool 과점유 방지
  - 10분 TTL 캐시(`ACTIVATION_CACHE`)로 세션 내 중복 활성화 방지
- migration-027-v25-reconsolidation-episode-spreading.sql (구 027~030 통합):
  - `fragment_links`: confidence NUMERIC(4,3), decay_rate NUMERIC(6,5), deleted_at, delete_reason, quarantine_state 컬럼 추가
  - `link_reconsolidations` 테이블: action별 weight/confidence 변경 이력
  - `case_events`: idempotency_key TEXT NULL 컬럼 + UNIQUE 인덱스
  - `idx_fragments_keywords_gin`: GIN 인덱스 (WHERE valid_to IS NULL), Spreading Activation 성능용
  - `idx_fragment_links_active`: (from_id, to_id, relation_type) WHERE deleted_at IS NULL
  - `idx_case_event_edges_preceded_by`: preceded_by 엣지 전용 인덱스
- `recall` 파라미터 `contextText` 추가: SpreadingActivation 사전 활성화 트리거 (ENABLE_SPREADING_ACTIVATION=true 시 동작)
- `tool_feedback` ENABLE_RECONSOLIDATION 연동: fragment_ids 지정 시 relevant=false → decay, relevant=true → reinforce action
- `ConflictResolver.checkAssertionConsistency()`: ENABLE_RECONSOLIDATION=true 시 `quarantineAdjacentLinks` 호출
- `GraphNeighborSearch`: fragment_links JOIN에 `AND fl.deleted_at IS NULL` 추가 — soft-deleted 링크 제외
- `MemoryManager.reflect()`: `EpisodeContinuityService.linkEpisodeMilestone()` fire-and-forget 호출
- `MemoryManager.recall()`: `SpreadingActivation.activateByContext()` fire-and-forget 사전 활성화
- feature flags: `ENABLE_RECONSOLIDATION` (기본 false), `ENABLE_SPREADING_ACTIVATION` (기본 false), `ENABLE_PATTERN_ABSTRACTION` (기본 false)
- `FragmentWriter.deleteMany(ids, agentId, keyId)`: fragment_links, linked_to 정리 후 일괄 삭제
- `FragmentStore.deleteMany()`: FragmentWriter.deleteMany 위임

## [2.4.0] - 2026-04-03

### Added
- `reconstruct_history` MCP tool: case_id/entity 기반 시간순 서사 재구성, BFS 인과 체인, case_events DAG 포함 반환 (HistoryReconstructor, migration-026 연동)
- `search_traces` MCP tool: fragments + search_events grep-like 탐색 (event_type/entity_key/keyword/case_id/session_id/time_range 필터, 기본 limit 20)
- `remember` 파라미터 6개 추가: `caseId`, `goal`, `outcome`, `phase`, `resolutionStatus`, `assertionStatus` (migration-025 연동)
- migration-025: fragments에 `case_id`, `goal`, `outcome`, `phase`, `resolution_status`, `assertion_status` 컬럼 추가 (`assertion_status` 기본값 `observed`)
- migration-026: `case_events`(semantic milestone) + `case_event_edges`(DAG, edge_type: caused_by/resolved_by/preceded_by/contradicts) + `fragment_evidence`(증거 조인) 테이블
- `CaseEventStore`: append/addEdge/addEvidence/getByCase/getBySession/deleteExpired 메서드
- `ConflictResolver.checkAssertionConsistency()`: Jaccard 유사도 기반 assertion 자동 분류 (비동기 fire-and-forget)
- `RERANKER_MODEL` 환경변수: `minilm`(기본) / `bge-m3` 선택 가능 (한국어 사용자 bge-m3 권장)
- Cloudflare Workers AI embedding provider 지원 (`CF_ACCOUNT_ID` + `CF_API_TOKEN`)

### Fixed
- workspace isolation: L1 HotCache bypass — `_executeSearch`에 RRF merge 후 workspace post-filter 추가 (cache miss fragments는 workspace 필드 미보장)
- workspace isolation: `FragmentReader.getByIds` SELECT에 workspace 컬럼 누락으로 모든 반환 파편의 workspace가 `undefined` → NULL 취급되는 버그 수정
- workspace isolation: `_searchL2` L1-miss 경로의 `getByIds` 결과에 workspace 후처리 필터 미적용 수정
- `recall` 응답 직렬화에 workspace 필드 누락 수정 (fragments 항목에 `workspace` 필드 추가)
- `reconstruct.js tool_reconstructHistory`: HistoryReconstructor 반환값에서 `case_events`, `event_dag` 필드 누락으로 MCP 응답에서 0/null 반환되던 버그 수정 (df2ebab)
- `HistoryReconstructor`: 임시 디버그 `logInfo` 제거, `logWarn`만 유지
- `_fetchTimelineParameterized` key_id isolation: `(f.key_id IS NULL OR f.key_id = $n)` → `($n::text IS NULL OR f.key_id = $n)` 수정 (master key null 전달 시 모든 파편 노출 방지)

### Changed
- Session TTL default 240min → 43200min (30일 슬라이딩 윈도우)
- Reranker: external 서비스 연속 3회 실패 시 in-process 모드 자동 전환
- TemporalLinker: API 키 격리 (keyId 기반 `key_id = ANY($n)` 필터), 링크 생성 `Promise.all` 병렬화
- server.js: 시작 시 `preloadReranker()` 비차단 호출 (fire-and-forget)

## [2.3.0] - 2026-04-02

### Added
- OAuth MCP compliance: RFC 7591 Dynamic Client Registration, auto-approve for trusted origins, consent screen
- API key usable as OAuth client_id for Claude.ai/ChatGPT Web Integration
- Trusted origin-based redirect_uri validation (claude.ai, chatgpt.com, platform.openai.com, copilot.microsoft.com, gemini.google.com)
- WWW-Authenticate header with resource_metadata on 401 responses
- Admin UI: daily-limit inline edit, permissions toggle, fragment_limit edit, group/status filters
- Knowledge graph: episode type (pink + glow), limit slider up to 10,000
- get_skill_guide tool: returns SKILL.md optimization guide (full or by section)
- Auto-update: check_update/apply_update tools, `memento update` CLI
- Session auto-recovery with keyId/groupKeyIds preservation
- Keyword rules in aiInstructions: project name + hostname
- migration-021-oauth-clients.sql, OAuthClientStore.js
- DEFAULT_DAILY_LIMIT, DEFAULT_PERMISSIONS, DEFAULT_FRAGMENT_LIMIT env vars
- OAUTH_TRUSTED_ORIGINS env var for origin-based redirect validation
- **Workspace isolation** (`migration-024`): `fragments.workspace` column partitions memories by project/role/client within the same API key. `api_keys.default_workspace` auto-tags on `remember` and auto-filters on `recall`/`context`. Search filter: `(workspace = $X OR workspace IS NULL)` — NULL fragments remain globally visible.
- Admin: `PATCH /keys/:id/workspace` endpoint to configure default workspace per key.
- MCP tools: `workspace` optional parameter added to `remember`, `recall`, `context`, `batch_remember`.
- DB: migration-024 — `fragments.workspace VARCHAR(255)`, `api_keys.default_workspace VARCHAR(255)`, composite index `(key_id, workspace)` and partial index `(workspace)`.

### Fixed
- Session TTL default 60min -> 240min
- Redis TTL sync: dynamic remaining time instead of fixed CACHE_SESSION_TTL
- SSE disconnect: preserve session (clear SSE response only)
- OAuth refresh_token: propagate is_api_key flag
- updateTtlTier: key_id isolation to prevent cross-key TTL modification
- Default API key permissions: read-only -> read+write
- Admin login: form POST + 302 redirect (SameSite=Lax)
- Static asset cache: Cloudflare CDN cache busting with timestamp query string
- recall schema: episode added to type enum
- memory-schema.sql CHECK constraints: episode, co_retrieved, short

### Documentation
- 13 docs synced: configuration, api-reference, INSTALL, architecture, admin-console-guide, internals, README (ko/en)
- SKILL.md rewritten: search decision tree, episode guide, multi-platform, token budget
- CHANGELOG.md synced with v2.3.0

## [2.2.1] - 2026-03-31

### Fixed
- migrate.js: pgvector 스키마 자동 감지 및 search_path 설정 추가. `nerdvana.vector_cosine_ops` 하드코딩 제거하여 표준 환경(public 스키마) 호환 복구
- migrate.js: dotenv로 .env 자동 로드. `POSTGRES_*` 변수로 `DATABASE_URL` 자동 구성하여 수동 지정 불필요

### Documentation
- README 한/영: 간소화된 업데이트 절차 추가 (`git pull → npm install → npm run migrate`)
- .env.example: `PGVECTOR_SCHEMA` 자동 감지 설명 강화

## [2.2.0] - 2026-03-31

### Added
- Consolidator per-stage duration metrics with `timedStage` wrapper (admin /stats `lastConsolidation`)
- Scheduler job registry for background task observability (`scheduler-registry.js`, admin /stats `schedulerJobs`)
- Per-layer search latency tracking: L1/L2/L3 ms recorded in search_events (admin /stats `pathPerformance`)
- Redis index warmup on server start (`FragmentIndex.warmup()`, eliminates cold-start L1 misses)
- API key fragment quota system (default 5000, `FRAGMENT_DEFAULT_LIMIT` env var)
- Episode fragment contextSummary auto-generation in reflect

### Fixed
- path-to-regexp ReDoS vulnerability (GHSA-j3q9, GHSA-27v5)
- L1 cache miss rate measurement: text-only queries no longer counted as L1 miss
- Quota check double-release bug
- migrate.js strips inner BEGIN/COMMIT for transactional safety
- migration-019: schema-qualified `nerdvana.vector_cosine_ops`

### Changed
- HNSW index: ef_construction 64→128, ef_search=80 session-level (migration-019)
- Added migration-020: search_events layer latency columns

### Documentation
- Tool count corrected 12→13 across all docs
- MCP instructions: recommend episode fragments with contextSummary in reflect

## [2.1.0] - 2026-03-29

### Added
- Episodic memory: episode type (1000자, 서사/맥락 기억), context_summary 선택 필드
- Episodic memory: session_id 기반 시간 인접 번들링 (includeContext=true)
- Episodic memory: reflect narrative_summary → episode 파편 자동 생성
- migration-017-episodic.sql: type CHECK 확장, context_summary/session_id 컬럼
- docs/architecture.md: 시스템 구조, DB 스키마, 3계층 검색, TTL 계층
- docs/configuration.md: 환경 변수, MEMORY_CONFIG, 임베딩 Provider, 테스트
- docs/api-reference.md: HTTP 엔드포인트, 프롬프트, 리소스, 사용 흐름
- docs/internals.md: MemoryEvaluator, MemoryConsolidator, 모순 탐지
- docs/cli.md: CLI 9개 명령어
- docs/benchmark.md: LongMemEval-S 벤치마크 상세 분석 리포트
- README/README.en: 벤치마크 성능 요약 섹션 (recall@5 88.3%, QA 45.4%)
- docs/*.en.md: 영문 분리 문서 6개 (architecture, configuration, api-reference, internals, cli, benchmark)
- docs/benchmark.md: 벤치마크 리포트 한국어 번역
- README: Memory vs Rules 섹션 추가

### Changed
- README.md: 1,486줄 → 166줄 입문 가이드로 재작성
- README.en.md: 한국어 README와 1:1 구조 동기화 재작성
- MCP serverInfo version 1.7.0 → 2.0.1, instructions에 episode type/includeContext 설명 추가
- Token budget: chars/4 추정 → js-tiktoken 정밀 계산으로 개선
- quickstart.md: memory-schema.sql → npm run migrate로 설치 안내 교체

### Fixed
- uuid[] → text[] 캐스팅 수정 (LinkedFragmentLoader, FragmentWriter)
- agent_id='default' 공유 파편이 다른 에이전트 SELECT에서 누락되던 문제 (OR 조건 추가)
- L1 Redis 검색에서 agentId 미지원 제한사항 문서화
- MemoryEvaluator 유형 제외 로직 명시, 프로덕션 인증 미설정 시 경고 로그 추가
- README 벤치마크 recall-QA gap 명시 및 알려진 제한사항 섹션 추가

### Changed (i18n)
- README.en.md: 영문 docs(.en.md)로 링크 변경

### Removed
- README.simple.md: 새 README가 이미 간결하므로 삭제

## [2.0.0] - 2026-03-28

### Added
- CLI tool: 9 subcommands via bin/memento.js (serve, migrate, cleanup, backfill, stats, health, recall, remember, inspect)
- CLI argument parser (lib/cli/parseArgs.js) with zero external dependencies
- Inline quality gate: FragmentFactory.validateContent() rejects content < 10 chars AND < 3 words, URL-only, null type+topic
- Semantic dedup gate in GraphLinker.linkFragment(): cos >= 0.95 soft delete, cos >= 0.90 warning
- Empty session reflect filter: skip AutoReflect when 0 tool calls, 0 fragments, or < 30s duration
- NLI contradiction recursion limit: MAX_CONTRADICTION_DEPTH=3 with pair tracking Set
- Semantic dedup in consolidate cycle: KNN cos >= 0.92 merge with anchor protection
- Memory compression layer: 30d+ inactive fragments grouped by cos >= 0.80, keep highest importance
- scripts/cleanup-noise.js: CLI tool for manual noise removal (--dry-run/--execute/--include-nli)
- Adaptive importance: computeAdaptiveImportance() with access boost + type-specific halfLife decay
- Low-importance warning: remember() returns warning + auto TTL short when importance < 0.3
- Recall metadata: created_at, age_days, access_count, confidence, linked[3] in recall response
- UtilityBaseline: anchor-average confidence scoring, refreshed per consolidate cycle
- L2.5 Graph search layer: 1-hop neighbor fragments injected into RRF pipeline (weight 1.5x)
- LinkedFragmentLoader: LATERAL JOIN for 1-hop linked fragment retrieval
- recall timeRange parameter: created_at BETWEEN filter for temporal queries
- context({structured:true}): hierarchical tree response (core/working/anchors/learning)
- Knowledge graph D3.js zoom/pan with auto-fit viewport
- migration-014: ttl_tier 'short' constraint
- migration-015: created_at DESC index for timeRange queries
- Config: DEDUP_BATCH_SIZE, DEDUP_MIN_FRAGMENTS, COMPRESS_AGE_DAYS, COMPRESS_MIN_GROUP, CONSOLIDATE_INTERVAL_MS

### Changed
- calibrateByFeedback: 24h -> 7d window, additive -> multiplicative (1.1x/0.85x)
- consolidate default interval: 6h (CONSOLIDATE_INTERVAL_MS, configurable)
- RRF weights: L1(2x) > L2.5Graph(1.5x) > L2(1x) = L3(1x)
- FragmentReader: utility_score included in all SELECT queries

### Security
- CORS origin whitelist via ALLOWED_ORIGINS env var (getAllowedOrigin helper)
- /metrics requires master key authentication
- /health returns minimal response for unauthenticated requests
- Admin panel blocked when MEMENTO_ACCESS_KEY unset
- Admin cookie: conditional Secure flag based on X-Forwarded-Proto
- Content-Security-Policy header on Admin UI
- db_query SQL validation: word-boundary regex, semicolon/comment/length/catalog/function blocking
- Gemini wiki prompt injection defense (XML tag delimiters)
- GitHub Actions pinned to SHA hashes

### Fixed
- CSP blocking Tailwind/D3/Google Fonts CDN resources
- Knowledge graph nodes overflowing viewport (no zoom/pan)

### Removed
- docs-mcp dead code from gemini.js (489 lines: generateContent, generateWikiContent, improveWikiContent, GEMINI_MODELS, braveSearch, generateWikiContentWithCLI, enhanceWikiContentWithCLI, checkGeminiStatus)

## [1.8.0] - 2026-03-28

### Added
- RBAC: tool-level permission enforcement (read/write/admin) via lib/rbac.js
- Fragment import/export API: GET /export (JSON Lines stream), POST /import
- Knowledge graph visualization: GET /memory/graph API + D3.js force-directed Admin tab
- Search quality dashboard: path distribution, latency percentiles (p50/p90/p99), top keywords, zero-result rate
- DB migration runner: scripts/migrate.js with transaction safety and schema_migrations tracking
- MemoryManager.create() static factory for dependency injection in tests
- MemoryEvaluator backpressure: queue size cap (EVALUATOR_MAX_QUEUE env, default 100)
- Sentiment-aware decay: tool_feedback fragment_ids parameter adjusts ema_activation
- Closed learning loop: searchPath tracking in SessionActivityTracker, learning extraction in AutoReflect, context() priority injection for learning fragments
- Temperature-weighted context sorting: warm window + access count + learning source boost
- FragmentReader.searchBySource() for source-based fragment queries

### Changed
- Admin routes split into 5 focused modules (admin-auth, admin-keys, admin-memory, admin-sessions, admin-logs)
- Admin authentication: QS ?key= replaced with opaque session token cookie (HttpOnly, SameSite=Strict)
- Gemini API key moved from URL query parameter to x-goog-api-key header
- ESLint config: browser globals added for assets/**/*.js
- Jest/node:test boundary: tests/unit/ excluded from Jest (node:test only), tests/*.test.js for Jest
- context() extras sorting uses temperature score (importance + warm boost + access count + learning boost)
- config/memory.js: added temperatureBoost, learning typeSlot

### Fixed
- npm audit vulnerabilities (flatted, picomatch, brace-expansion)
- ESLint 606 errors from missing browser globals
- Jest 34/42 suite failures from node:test module resolution
- Admin cookie auth: validateAdminAccess used instead of validateMasterKey in API dispatcher
- Export query: nonexistent updated_at column replaced with accessed_at

### Security
- Admin QS key exposure eliminated (cookie-based session tokens)
- Gemini API key no longer appears in URL query strings or logs
- RBAC prevents read-only API keys from executing write operations

## [1.7.0] - 2026-03-26

### Added
- Admin operations console with 6 management tabs (overview, API keys, groups, memory operations, sessions, system logs)
- Stitch-aligned UI design system (Tailwind CSS, Material Symbols, Space Grotesk + Plus Jakarta Sans)
- 12 new admin API endpoints: memory operations (4), session management (6), log viewer (3)
- Static asset serving with path traversal protection
- Session activity monitoring with Redis-based tracking
- Bulk session reflect for orphaned unreflected sessions
- Log file reverse-read for large file tail support
- Windowed pagination (10-page window centered on current)

### Changed
- Admin UI rewritten from 1928-line inline HTML to modular app shell (index.html + admin.css + admin.js)
- GET /stats expanded with searchMetrics, observability, queues, healthFlags
- Static assets served without auth (browser resource requests)

### Fixed
- URL ?key= parameter authentication for direct admin access
- Inline display:none preventing CSS class override
- Duplicate getSearchMetrics import from merge
- Memory fragments parsing (data.items vs data.fragments)
- Groups column rendering object instead of name
- Anomalies query using nonexistent updated_at column (-> accessed_at)
- Active sessions excluded from unreflected count
- Log file 50MB size limit replaced with reverse-read tail

## [1.6.1] - 2026-03-25

### Added
- Search observability infrastructure (searchPath persistence, tool_feedback FK)
- search_events table (migration-013) for query/result observability
- SearchEventRecorder for FragmentSearch.search() result logging
- SearchEventAnalyzer for search pattern analysis

### Fixed
- ESLint glob tests/*.test.js -> tests/**/*.test.js for nested test dirs

## [1.6.0] - 2026-03-19

### Added
- GC search_events older than 30 days in consolidation cycle
- Context seen-ids deduplication
- Quality improvements
