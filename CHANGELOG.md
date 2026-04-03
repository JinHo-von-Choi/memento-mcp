# Changelog

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
