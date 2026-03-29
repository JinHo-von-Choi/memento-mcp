# Changelog

## [2.0.1] - 2026-03-29

### Changed
- README.md: 1,486줄 → 166줄 입문 가이드로 재작성
- README.en.md: 한국어 README와 1:1 구조 동기화 재작성

### Added
- docs/architecture.md: 시스템 구조, DB 스키마, 3계층 검색, TTL 계층
- docs/configuration.md: 환경 변수, MEMORY_CONFIG, 임베딩 Provider, 테스트
- docs/api-reference.md: HTTP 엔드포인트, 프롬프트, 리소스, 사용 흐름
- docs/internals.md: MemoryEvaluator, MemoryConsolidator, 모순 탐지
- docs/cli.md: CLI 9개 명령어
- docs/benchmark.md: LongMemEval-S 벤치마크 상세 분석 리포트
- README/README.en: 벤치마크 성능 요약 섹션 (recall@5 88.3%, QA 45.4%)
- docs/*.en.md: 영문 분리 문서 6개 (architecture, configuration, api-reference, internals, cli, benchmark)
- docs/benchmark.md: 벤치마크 리포트 한국어 번역

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
- consolidate default interval: 6h -> 1h (CONSOLIDATE_INTERVAL_MS)
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
