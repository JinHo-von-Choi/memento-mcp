# Changelog

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
