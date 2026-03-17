<p align="center">
  <img src="assets/images/memento_mcp_logo_transparent.png" width="400" alt="Memento MCP Logo">
</p>

<p align="center">
  <a href="https://lobehub.com/mcp/jinho-von-choi-memento-mcp">
    <img src="https://lobehub.com/badge/mcp/jinho-von-choi-memento-mcp" alt="MCP Badge" />
  </a>
  <a href="https://github.com/JinHo-von-Choi/memento-mcp/releases">
    <img src="https://img.shields.io/github/v/release/JinHo-von-Choi/memento-mcp?style=flat&label=release&color=4c8bf5" alt="GitHub Release" />
  </a>
  <a href="https://github.com/JinHo-von-Choi/memento-mcp/stargazers">
    <img src="https://img.shields.io/github/stars/JinHo-von-Choi/memento-mcp?style=flat&color=f5c542" alt="GitHub Stars" />
  </a>
  <a href="https://github.com/JinHo-von-Choi/memento-mcp/issues">
    <img src="https://img.shields.io/github/issues/JinHo-von-Choi/memento-mcp?style=flat&color=e05d44" alt="GitHub Issues" />
  </a>
  <a href="https://github.com/JinHo-von-Choi/memento-mcp/commits/main">
    <img src="https://img.shields.io/github/last-commit/JinHo-von-Choi/memento-mcp?style=flat&color=brightgreen" alt="Last Commit" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat" alt="License" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-pgvector%20HNSW-4169E1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Redis-L1%20Cache-DC382D?style=flat&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/MCP-2025--11--25-7c3aed?style=flat" alt="MCP Protocol" />
  <img src="https://img.shields.io/badge/transport-Streamable%20HTTP%20%7C%20SSE-0ea5e9?style=flat" alt="Transport" />
  <img src="https://img.shields.io/badge/auth-OAuth%202.0%20PKCE-f59e0b?style=flat" alt="Auth" />
</p>

# Memento MCP

빠른 진입 경로:

- [Quick Start](docs/getting-started/quickstart.md)
- [Windows WSL2 Setup](docs/getting-started/windows-wsl2.md)
- [Windows PowerShell Setup](docs/getting-started/windows-powershell.md)
- [Claude Code Configuration](docs/getting-started/claude-code.md)
- [First Memory Flow](docs/getting-started/first-memory-flow.md)
- [Troubleshooting](docs/getting-started/troubleshooting.md)
- [설치 가이드](INSTALL.md)

## Quick Start

최소 구성 기준:

- 필수: Node.js 20+, PostgreSQL, `vector` extension
- 선택: Redis
- 선택: 임베딩 provider
- 선택: Claude Code 연동

가장 짧은 실행 경로:

```bash
cp .env.example.minimal .env
# .env 값을 편집한 뒤 셸에 반영
export $(grep -v '^#' .env | grep '=' | xargs)
npm install
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql "$DATABASE_URL" -f lib/memory/memory-schema.sql
node server.js
```

서버가 뜬 뒤에는 [First Memory Flow](docs/getting-started/first-memory-flow.md)로 `remember`, `recall`, `context` 호출을 검증한다.

## 지원 환경

| 환경 | 권장도 | 시작 문서 |
|------|--------|-----------|
| Linux / macOS | 권장 | [Quick Start](docs/getting-started/quickstart.md) |
| Windows + WSL2 | 가장 권장 | [Windows WSL2 Setup](docs/getting-started/windows-wsl2.md) |
| Windows + PowerShell | 제한 지원 | [Windows PowerShell Setup](docs/getting-started/windows-powershell.md) |

## Claude Code가 필요한 경우

- memento 서버만 직접 실행할 경우: Claude Code 설정 불필요
- Claude Code가 기억 도구를 직접 쓰게 할 경우: [Claude Code Configuration](docs/getting-started/claude-code.md) 필요

## 개요

Memento MCP는 MCP(Model Context Protocol) 기반 에이전트 장기 기억 서버다. 세션이 종료되어도 중요한 사실, 결정, 에러 패턴, 절차를 유지하고 다음 세션에서 복원한다.

지식은 1~3문장의 원자적 단위인 **파편(fragment)**으로 분해하여 저장한다. 세션 요약을 통째로 저장하면 관련 없는 내용까지 컨텍스트 창을 차지하고 필요한 정보만 골라내기가 어렵다. 파편 단위로 쪼개면 검색 시 필요한 정보만 정확히 반환할 수 있다.

파편은 여섯 유형으로 분류된다: `fact`, `decision`, `error`, `preference`, `procedure`, `relation`. 유형마다 기본 중요도와 감쇠 속도가 다르다.

![지식 네트워크](assets/images/knowledge-graph.png)

검색은 세 계층을 순서대로 통과한다. Redis Set 연산으로 키워드 교집합을 찾고, PostgreSQL GIN 인덱스로 배열 검색을 수행하고, pgvector HNSW로 코사인 유사도를 계산한다. 기억을 잘 저장하는 것만큼 잘 찾아내는 것도 중요하다. 찾지 못하는 기억은 없는 기억과 같다.

![토큰 효율성](assets/images/token-efficiency.png)

임베딩은 remember 시점에 인라인 생성되지 않는다. EmbeddingWorker가 Redis 큐에서 파편 ID를 소비하여 비동기로 임베딩을 생성하고, 완료 시 `embedding_ready` 이벤트를 발행한다. GraphLinker가 이 이벤트를 구독하여 유사 파편 간 관계를 자동 생성한다. importance와 무관하게 모든 파편이 임베딩 대상이다.

비동기 품질 평가 워커가 백그라운드에서 새 파편을 감시한다. Gemini CLI를 호출하여 내용의 합리성을 검토하고 utility_score를 갱신한다. 주기적 유지보수 파이프라인이 중요도 감쇠, TTL 전환, 중복 병합, 모순 탐지, 고아 링크 정리를 담당한다. 모순 탐지는 3단계 하이브리드로 동작한다 — pgvector 유사도 필터, NLI(Natural Language Inference) 분류, Gemini CLI 에스컬레이션. NLI가 명확한 논리적 모순을 저비용으로 즉시 해소하고, 수치/도메인 모순처럼 NLI가 불확실한 케이스만 Gemini에 넘긴다. 세션이 종료되면 자동으로 reflect가 실행되어 세션 내 활동이 구조화된 파편으로 영속화된다. 기억은 저장으로 끝나지 않는다. 관리되어야 한다.

MCP 프로토콜 버전 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05를 지원한다. Streamable HTTP와 Legacy SSE를 동시에 제공하며 OAuth 2.0 PKCE 인증을 내장한다. 서버는 포트 57332에서 대기한다.

---

## 시스템 구조

![시스템 아키텍처](assets/images/memento_architecture.svg)

```
server.js  (HTTP 서버)
    │
    ├── POST /mcp          Streamable HTTP — JSON-RPC 수신
    ├── GET  /mcp          Streamable HTTP — SSE 스트림
    ├── DELETE /mcp        Streamable HTTP — 세션 종료
    ├── GET  /sse          Legacy SSE — 세션 생성
    ├── POST /message      Legacy SSE — JSON-RPC 수신
    ├── GET  /health       헬스 체크
    ├── GET  /metrics      Prometheus 메트릭
    ├── GET  /authorize    OAuth 2.0 인가 엔드포인트
    ├── POST /token        OAuth 2.0 토큰 엔드포인트
    ├── GET  /.well-known/oauth-authorization-server
    └── GET  /.well-known/oauth-protected-resource
    │
    ├── lib/jsonrpc.js        JSON-RPC 2.0 파싱 및 메서드 디스패치
    ├── lib/tool-registry.js  12개 기억 도구 등록 및 라우팅
    │
    └── lib/memory/
            ├── MemoryManager.js          비즈니스 로직 파사드 (싱글턴)
            ├── FragmentFactory.js        파편 생성, 유효성 검증, PII 마스킹
            ├── FragmentStore.js          PostgreSQL CRUD 파사드 (FragmentReader + FragmentWriter 위임)
            ├── FragmentReader.js         파편 읽기 (getById, getByIds, getHistory, searchByKeywords, searchBySemantic)
            ├── FragmentWriter.js         파편 쓰기 (insert, update, delete, incrementAccess, touchLinked)
            ├── FragmentSearch.js         3계층 검색 조율 (구조적: L1→L2, 시맨틱: L1→L2‖L3 RRF 병합)
            ├── FragmentIndex.js          Redis L1 인덱스 관리
            ├── EmbeddingWorker.js        Redis 큐 기반 비동기 임베딩 생성 워커 (EventEmitter)
            ├── GraphLinker.js            임베딩 완료 이벤트 구독 자동 관계 생성 + 소급 링킹 + Hebbian co-retrieval 링킹
            ├── MemoryConsolidator.js     18단계 유지보수 파이프라인 (NLI + Gemini 하이브리드)
            ├── MemoryEvaluator.js        비동기 Gemini CLI 품질 평가 워커 (싱글턴)
            ├── NLIClassifier.js          NLI 기반 모순 분류기 (mDeBERTa ONNX, CPU)
            ├── SessionActivityTracker.js 세션별 도구 호출/파편 활동 추적 (Redis)
            ├── ConflictResolver.js       remember 시점 충돌 감지, 자동 링크, supersede 처리
            ├── SessionLinker.js         세션 파편 통합, 자동 링크, 사이클 감지
            ├── LinkStore.js             파편 링크 관리 (fragment_links CRUD + RCA 체인)
            ├── FragmentGC.js            파편 만료 삭제, 지수 감쇠, TTL 계층 전환 (permanent parole + EMA 배치 감쇠 포함)
            ├── ConsolidatorGC.js        피드백 리포트, stale 파편 수집/정리, 긴 파편 분할, 피드백 기반 보정
            ├── ContradictionDetector.js 모순 감지, 대체 관계 감지, 보류 큐 처리
            ├── AutoReflect.js            세션 종료 시 자동 reflect 오케스트레이터
            ├── decay.js                  지수 감쇠 반감기 상수, 순수 계산 함수, ACT-R EMA 활성화 근사 (`updateEmaActivation`, `computeEmaRankBoost`), EMA 기반 동적 반감기 (`computeDynamicHalfLife`), 나이 가중치 utility score (`computeUtilityScore`)
            ├── SearchMetrics.js          L1/L2/L3/total 레이어별 지연 시간 수집 (Redis 원형 버퍼, P50/P90/P99)
            ├── EvaluationMetrics.js      tool_feedback 기반 implicit Precision@5 및 downstream task 성공률 계산
            ├── normalize-vectors.js      기존 임베딩 L2 정규화 일회성 마이그레이션 스크립트
            ├── backfill-embeddings.js    기존 파편 임베딩 일괄 생성 스크립트 (1회성)
            ├── memory-schema.sql         PostgreSQL 스키마 정의
            ├── migration-001-temporal.sql Temporal 스키마 마이그레이션 (valid_from/to/superseded_by)
            ├── migration-002-decay.sql   감쇠 멱등성 마이그레이션 (last_decay_at)
            ├── migration-003-api-keys.sql API 키 관리 테이블 (api_keys, api_key_usage)
            ├── migration-004-key-isolation.sql fragments.key_id 컬럼 추가 (API 키 기반 기억 격리)
            ├── migration-005-gc-columns.sql   GC 정책 강화 인덱스 (utility_score, access_count)
            ├── migration-006-superseded-by-constraint.sql fragment_links CHECK에 superseded_by 추가
            ├── migration-007-link-weight.sql  fragment_links.weight 컬럼 추가 (링크 강도 수치화)
            ├── migration-008-morpheme-dict.sql 형태소 사전 테이블 (morpheme_dict)
            ├── migration-009-co-retrieved.sql fragment_links CHECK에 co_retrieved 추가 (Hebbian 링킹)
            ├── migration-010-ema-activation.sql fragments.ema_activation/ema_last_updated 컬럼 추가
            ├── migration-011-key-groups.sql  API 키 그룹 N:M 매핑 (api_key_groups, api_key_group_members)
            └── migration-012-quality-verified.sql fragments.quality_verified 컬럼 추가 (MemoryEvaluator 판정 결과 영속화)
```

지원 모듈:

```
lib/
├── config.js          환경변수를 상수로 노출
├── auth.js            Bearer 토큰 검증
├── oauth.js           OAuth 2.0 PKCE 인가/토큰 처리
├── sessions.js        Streamable/Legacy SSE 세션 생명주기
├── redis.js           ioredis 클라이언트 (Sentinel 지원)
├── gemini.js          Google Gemini API/CLI 클라이언트 (geminiCLIJson, isGeminiCLIAvailable)
├── compression.js     응답 압축 (gzip/deflate)
├── metrics.js         Prometheus 메트릭 수집 (prom-client)
├── logger.js          Winston 로거 (daily rotate)
├── rate-limiter.js    IP 기반 sliding window rate limiter
├── http-handlers.js   MCP/SSE HTTP 핸들러 (Admin 라우트는 admin-routes.js로 분리)
├── scheduler.js       주기 작업 스케줄러 (setInterval 작업 관리)
└── utils.js           Origin 검증, JSON 바디 파싱(2MB 상한), SSE 출력

lib/admin/
├── ApiKeyStore.js     API 키 CRUD, 그룹 CRUD, 인증 검증 (SHA-256 해시 저장, 원시 키 단 1회 반환)
└── admin-routes.js    Admin REST API 라우트 + UI 서빙 (그룹 관리, 인증 게이트)

lib/http/
└── helpers.js         HTTP SSE 스트림 헬퍼 및 요청 파싱 유틸리티

lib/logging/
└── audit.js           감사 로그 및 접근 이력 기록
```

도구 구현은 `lib/tools/`에 분리되어 있다.

```
lib/tools/
├── memory.js    12개 MCP 도구 핸들러
├── memory-schemas.js  도구 스키마 정의 (inputSchema)
├── db.js        PostgreSQL 연결 풀, RLS 적용 쿼리 헬퍼 (MCP 미노출)
├── db-tools.js  MCP DB 도구 핸들러 (db.js에서 분리된 도구별 로직)
├── embedding.js OpenAI 텍스트 임베딩 생성
├── stats.js     접근 통계 수집 및 저장
├── prompts.js   MCP Prompts 정의 (analyze-session, retrieve-relevant-memory 등)
├── resources.js MCP Resources 정의 (memory://stats, memory://topics 등)
└── index.js     도구 핸들러 export
```

`config/memory.js`는 별도 파일로 분리된 기억 시스템 설정이다. 시간-의미 복합 랭킹 가중치, stale 임계값, 임베딩 워커, 컨텍스트 주입, 페이지네이션, GC 정책을 담는다.

---

## 데이터베이스 스키마

스키마명은 `agent_memory`다. 스키마 파일: `lib/memory/memory-schema.sql`.

```mermaid
erDiagram
    fragments ||--o{ fragment_links : "from/to"
    fragments ||--o{ fragment_versions : "history"
    fragments {
        text id PK
        text content "PII Masked"
        text topic
        text_array keywords
        text type "fact/decision/error..."
        real importance
        text content_hash "Unique"
        text_array linked_to
        text agent_id "RLS Key"
        integer access_count
        real utility_score
        vector embedding "OpenAI 1536, L2 정규화"
        boolean is_anchor
        timestamptz valid_from "Temporal 유효 시작"
        timestamptz valid_to "Temporal 유효 종료 (NULL=현재)"
        text superseded_by "대체 파편 ID"
        timestamptz last_decay_at "마지막 감쇠 시각"
        text key_id "API 키 격리 (NULL=마스터)"
        float ema_activation "ACT-R EMA 활성화 근사값 (DEFAULT 0.0)"
        timestamptz ema_last_updated "EMA 마지막 갱신 시각"
        boolean quality_verified "MemoryEvaluator 판정: NULL=미평가, TRUE=keep, FALSE=downgrade/discard"
    }
    fragment_links {
        bigserial id PK
        text from_id FK
        text to_id FK
        text relation_type
        integer weight "링크 강도 (co_retrieved 횟수 누적)"
    }
    tool_feedback {
        bigserial id PK
        text tool_name
        boolean relevant
        boolean sufficient
        text session_id
    }
    task_feedback {
        bigserial id PK
        text session_id
        boolean overall_success
    }
```

### fragments

모든 파편의 저장소. 시스템의 핵심 테이블이다.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | 파편 고유 식별자 |
| content | TEXT | NOT NULL | 기억 내용 본문 (300자 권장, 원자적 1~3문장) |
| topic | TEXT | NOT NULL | 주제 레이블 (예: database, deployment, security) |
| keywords | TEXT[] | NOT NULL DEFAULT '{}' | 검색용 키워드 배열 (GIN 인덱스) |
| type | TEXT | NOT NULL, CHECK | fact / decision / error / preference / procedure / relation |
| importance | REAL | 0.0~1.0 CHECK | 중요도. type별 기본값, MemoryConsolidator에 의해 감쇠 |
| content_hash | TEXT | UNIQUE | SHA 해시 기반 중복 방지 |
| source | TEXT | | 출처 식별자 (세션 ID, 도구명 등) |
| linked_to | TEXT[] | DEFAULT '{}' | 연결 파편 ID 목록 (GIN 인덱스) |
| agent_id | TEXT | NOT NULL DEFAULT 'default' | RLS 격리 기준 에이전트 ID |
| access_count | INTEGER | DEFAULT 0 | 회상 횟수 — utility_score 산정에 반영 |
| accessed_at | TIMESTAMPTZ | | 최근 회상 시각 |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | 생성 시각 |
| ttl_tier | TEXT | CHECK | hot / warm(기본) / cold / permanent |
| estimated_tokens | INTEGER | DEFAULT 0 | cl100k_base 토큰 수 — tokenBudget 계산에 사용 |
| utility_score | REAL | DEFAULT 1.0 | MemoryEvaluator/MemoryConsolidator가 갱신하는 유용성 점수 |
| verified_at | TIMESTAMPTZ | DEFAULT NOW() | 마지막 품질 검증 시각 |
| embedding | vector(1536) | | OpenAI text-embedding-3-small 벡터. 저장 전 L2 정규화(단위 벡터) 적용 |
| is_anchor | BOOLEAN | DEFAULT FALSE | true 시 감쇠, TTL 강등, 만료 삭제 전부 면제 |
| valid_from | TIMESTAMPTZ | DEFAULT NOW() | Temporal 유효 구간 시작. `asOf` 쿼리의 하한 |
| valid_to | TIMESTAMPTZ | | Temporal 유효 구간 종료. NULL이면 현재 유효 파편 |
| superseded_by | TEXT | | 이 파편을 대체한 파편의 ID |
| last_decay_at | TIMESTAMPTZ | | 마지막 감쇠 적용 시각. NULL이면 accessed_at/created_at 기준으로 보정 |
| key_id | TEXT | FK → api_keys.id, ON DELETE SET NULL | API 키 기반 기억 격리. NULL이면 마스터 키(MEMENTO_ACCESS_KEY)로 저장된 기억. 값이 있으면 해당 API 키로만 조회 가능 |
| ema_activation | FLOAT | DEFAULT 0.0 | ACT-R 기저 활성화 EMA 근사값. `incrementAccess()` 호출 시 `α * (Δt_sec)^{-0.5} + (1-α) * prev` 수식으로 갱신(α=0.3). L1 fallback 경로에서는 갱신되지 않음(noEma=true). `_computeRankScore()`에서 importance 부스트로 활용 |
| ema_last_updated | TIMESTAMPTZ | | EMA 마지막 갱신 시각. NULL이면 created_at 기준으로 보정 |
| quality_verified | BOOLEAN | DEFAULT NULL | MemoryEvaluator 품질 판정 결과. NULL=미평가, TRUE=keep(검증됨), FALSE=downgrade/discard(부정). permanent 승격 Circuit Breaker에 사용됨 |

인덱스 목록: content_hash(UNIQUE), topic(B-tree), type(B-tree), keywords(GIN), importance DESC(B-tree), created_at DESC(B-tree), agent_id(B-tree), linked_to(GIN), (ttl_tier, created_at)(B-tree), source(B-tree), verified_at(B-tree), is_anchor WHERE TRUE(부분 인덱스), valid_from(B-tree), (topic, type) WHERE valid_to IS NULL(부분 인덱스), id WHERE valid_to IS NULL(부분 UNIQUE).

HNSW 벡터 인덱스는 `embedding IS NOT NULL` 조건부 인덱스로 생성된다. 파라미터: m=16(이웃 연결 수), ef_construction=64(인덱스 구축 탐색 깊이), 거리 함수 vector_cosine_ops.

### fragment_links

파편 간 관계망을 전담하는 별도 테이블. fragments 테이블의 linked_to 배열과 병행하여 존재한다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGSERIAL PK | 자동 증가 식별자 |
| from_id | TEXT | 출발 파편 (ON DELETE CASCADE) |
| to_id | TEXT | 도착 파편 (ON DELETE CASCADE) |
| relation_type | TEXT | related / caused_by / resolved_by / part_of / contradicts / superseded_by / co_retrieved |
| weight | INTEGER | 링크 강도. `co_retrieved` 관계는 공동 회상 시마다 +1 누적. 기본값 1 |
| created_at | TIMESTAMPTZ | 관계 생성 시각 |

(from_id, to_id) 조합에 UNIQUE 제약이 걸려 있다. 중복 링크는 저장되지 않고 weight가 증가한다.

`co_retrieved` 링크는 recall 결과에 2개 이상 파편이 반환될 때 `GraphLinker.buildCoRetrievalLinks()`가 비동기로 생성한다. Hebbian 연관 학습 원리에 따라 자주 함께 검색되는 파편 쌍의 weight가 높아진다.

### tool_feedback

도구 유용성 피드백. recall이 의도에 맞는 결과를 반환했는지, 작업 완료에 충분했는지를 기록한다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGSERIAL PK | |
| tool_name | TEXT | 평가 대상 도구명 |
| relevant | BOOLEAN | 결과가 요청 의도와 관련 있었는가 |
| sufficient | BOOLEAN | 결과가 작업 완료에 충분했는가 |
| suggestion | TEXT | 개선 제안 (100자 이내 권장) |
| context | TEXT | 사용 맥락 요약 (50자 이내 권장) |
| session_id | TEXT | 세션 식별자 |
| trigger_type | TEXT | sampled(훅 샘플링) / voluntary(AI 자발적 호출) |
| created_at | TIMESTAMPTZ | |

### task_feedback

세션 단위 작업 효과성. reflect 도구의 task_effectiveness 파라미터로 기록된다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGSERIAL PK | |
| session_id | TEXT | 세션 식별자 |
| overall_success | BOOLEAN | 세션의 주요 작업이 성공적으로 완료되었는가 |
| tool_highlights | TEXT[] | 특히 유용했던 도구와 이유 목록 |
| tool_pain_points | TEXT[] | 불편하거나 개선이 필요한 도구와 이유 목록 |
| created_at | TIMESTAMPTZ | |

### fragment_versions

amend 도구로 파편을 수정할 때마다 이전 버전이 여기에 보존된다. 수정 이력의 감사 추적(audit trail).

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGSERIAL PK | |
| fragment_id | TEXT | 원본 파편 ID (ON DELETE CASCADE) |
| content | TEXT | 수정 전 내용 |
| topic | TEXT | 수정 전 주제 |
| keywords | TEXT[] | 수정 전 키워드 |
| type | TEXT | 수정 전 유형 |
| importance | REAL | 수정 전 중요도 |
| amended_at | TIMESTAMPTZ | 수정 시각 |
| amended_by | TEXT | 수정한 agent_id |

### Row-Level Security

fragments 테이블에 RLS가 활성화되어 있다. 정책명은 `fragment_isolation_policy`. 판단 기준은 세션 변수 `app.current_agent_id`다.

```sql
CREATE POLICY fragment_isolation_policy ON agent_memory.fragments
    USING (
        agent_id = current_setting('app.current_agent_id', true)
        OR agent_id = 'default'
        OR current_setting('app.current_agent_id', true) IN ('system', 'admin')
    );
```

에이전트 ID가 일치하는 파편, `default` 에이전트의 파편(공용 데이터), `system`/`admin` 세션(유지보수용)에만 접근이 허용된다. 도구 핸들러는 쿼리 실행 직전 `SET LOCAL app.current_agent_id = $1`로 컨텍스트를 설정한다.

### API 키 기반 기억 격리

`key_id` 컬럼을 통해 API 키 단위의 추가 격리 레이어를 지원한다. 마스터 키(`MEMENTO_ACCESS_KEY`)로 접속한 요청이 저장한 파편은 `key_id = NULL`이며 마스터 키로만 조회 가능하다. DB에 발급된 API 키로 접속한 요청이 저장한 파편은 `key_id = <해당 키 ID>`로 기록되며 그 키만 조회할 수 있다.

이 격리 모델은 다중 에이전트 환경에서 키 단위 메모리 파티셔닝을 구현한다. API 키는 Admin SPA(`/v1/internal/model/nothing`)에서 관리하며, 생성 시 원시 키(`mmcp_<slug>_<32 hex>`)는 응답에서 단 1회만 반환되고 DB에는 SHA-256 해시만 저장된다.

Admin UI(`/v1/internal/model/nothing`)는 마스터 키 인증이 필요하다. Authorization Bearer 헤더 또는 `?key=` 쿼리 파라미터로 인증한다.

### API 키 그룹

같은 그룹에 속한 API 키들은 동일한 파편 격리 범위를 공유한다. 여러 에이전트(Claude Code, Codex, Gemini 등)가 하나의 프로젝트 기억을 공유할 때 사용한다.

- N:M 매핑: 한 키가 복수 그룹에 소속 가능 (`api_key_group_members` 테이블)
- 격리 해상도: 인증 시 `COALESCE(group_id, api_keys.id)`를 effective_key_id로 사용
- 그룹 미소속 키: 기존 동작 유지 (자체 id로 격리)

Admin REST 엔드포인트:

| Method | Path | 설명 |
|--------|------|------|
| GET | `.../groups` | 그룹 목록 (key_count 포함) |
| POST | `.../groups` | 그룹 생성 (`{ name, description? }`) |
| DELETE | `.../groups/:id` | 그룹 삭제 (멤버십 CASCADE) |
| GET | `.../groups/:id/members` | 그룹 소속 키 목록 |
| POST | `.../groups/:id/members` | 키를 그룹에 추가 (`{ key_id }`) |
| DELETE | `.../groups/:gid/members/:kid` | 키를 그룹에서 제거 |

---

## 프롬프트 (Prompts)

미리 정의된 가이드라인으로 AI가 기억 시스템을 효율적으로 사용하도록 돕는다.

| 이름 | 설명 | 주요 역할 |
|------|------|----------|
| `analyze-session` | 세션 활동 분석 | 현재 대화에서 저장할 가치가 있는 결정, 에러, 절차를 자동으로 추출하도록 유도 |
| `retrieve-relevant-memory` | 관련 기억 검색 가이드 | 특정 주제에 대해 키워드와 시맨틱 검색을 병행하여 최적의 컨텍스트를 찾도록 보조 |
| `onboarding` | 시스템 사용법 안내 | AI가 Memento MCP의 도구들을 언제 어떻게 써야 하는지 스스로 학습 |

---

## 리소스 (Resources)

기억 시스템의 현재 상태를 실시간으로 조회할 수 있는 MCP 리소스.

| URI | 설명 | 데이터 소스 |
|-----|------|------------|
| `memory://stats` | 시스템 통계 | `fragments` 테이블의 유형별, 계층별 카운트 및 유용성 점수 평균 |
| `memory://topics` | 주제 목록 | `fragments` 테이블의 모든 고유한 `topic` 레이블 목록 |
| `memory://config` | 시스템 설정 | `MEMORY_CONFIG`에 정의된 가중치 및 TTL 임계값 |
| `memory://active-session` | 세션 활동 로그 | `SessionActivityTracker`(Redis)에 기록된 현재 세션의 도구 사용 이력 |

---

## 3계층 검색

recall 도구는 비용이 낮은 계층부터 순서대로 검색한다. 앞 계층에서 충분한 결과가 나오면 뒤 계층은 실행하지 않는다.

![검색 흐름](assets/images/retrieval_flow.svg)

**L1: Redis Set 교집합.** 파편이 저장될 때마다 FragmentIndex가 각 키워드를 Redis Set의 키로 사용하여 파편 ID를 저장한다. `keywords:database`라는 Set에는 database를 키워드로 가진 모든 파편의 ID가 들어 있다. 다중 키워드 검색은 여러 Set의 SINTER 연산이다. 교집합 연산의 시간 복잡도는 O(N·K), N은 가장 작은 Set의 크기, K는 키워드 수다. Redis가 인메모리로 처리하므로 수 밀리초 안에 완료된다. L1 결과는 이후 단계에서 L2 결과와 병합된다.

**L2: PostgreSQL GIN 인덱스.** L1 실행 후 항상 실행된다. keywords TEXT[] 컬럼에 GIN(Generalized Inverted Index) 인덱스가 걸려 있다. 검색은 `keywords && ARRAY[...]` 연산자로 수행한다 — 배열 간 교집합 존재 여부를 묻는 연산자다. GIN 인덱스는 배열의 각 원소를 개별적으로 인덱싱하므로 이 연산이 인덱스 스캔으로 처리된다. 순차 스캔이 아니다.

**L3: pgvector HNSW 코사인 유사도.** recall 파라미터에 `text` 필드가 있을 때만 발동한다. 결과 수 부족만으로는 L3가 활성화되지 않는다. 쿼리 텍스트를 임베딩 벡터로 변환하여 `embedding <=> $1` 연산자로 코사인 거리를 계산한다. 모든 임베딩은 L2 정규화된 단위 벡터이므로 코사인 유사도와 내적이 동치다. HNSW 인덱스가 근사 최근접 이웃을 빠르게 찾는다. `threshold` 파라미터로 유사도 하한을 지정할 수 있다 — 이 값 미만의 L3 결과는 결과에서 제외된다. L1/L2 경유 결과는 similarity 값이 없으므로 threshold 필터링에서 제외된다.

모든 계층의 결과는 최종 단계에서 `valid_to IS NULL` 필터를 통과한다 — superseded_by로 대체된 파편은 기본적으로 검색에서 제외된다. `includeSuperseded: true`를 전달하면 만료된 파편도 포함된다.

Redis와 임베딩 API는 선택 사항이다. 없으면 해당 계층 없이 작동한다. PostgreSQL만으로도 L2 검색과 기본 기능은 완전히 동작한다.

**RRF 하이브리드 병합.** `text` 파라미터가 있을 때 L2와 L3는 `Promise.all`로 병렬 실행된다. 결과는 Reciprocal Rank Fusion(RRF)으로 병합된다: `score(f) = Σ w/(k + rank + 1)`, 기본값 k=60. L1 결과는 l1WeightFactor(기본 2.0)를 곱하여 최우선으로 주입된다. L1에만 있고 content 필드가 없는 파편(내용 미로드)은 최종 결과에서 제외된다. `text` 파라미터 없이 keywords/topic/type만 사용하면 L3 없이 L1+L2 결과만으로 응답한다.

세 계층의 결과가 RRF로 병합된 뒤 시간-의미 복합 랭킹이 적용된다. 복합 점수 공식: `score = effectiveImportance × 0.4 + temporalProximity × 0.3 + similarity × 0.3`. effectiveImportance는 `importance + computeEmaRankBoost(ema_activation) × 0.5`로 계산된다 — ACT-R EMA 활성화 값이 높을수록 자주 회상된 파편의 랭킹이 추가로 부스트된다. `computeEmaRankBoost(ema) = 0.2 × (1 - e^{-ema})`이며 최대 부스트는 0.10이다. 상한을 0.3→0.2로 제한한 이유: importance=0.65 파편의 effectiveImportance가 최대 0.65+0.10×0.5=0.70으로 permanent 승격 기준(importance≥0.8)에 미달, 가비지 파편의 등급 상향 순환을 차단한다. temporalProximity는 anchorTime(기본: 현재 시각) 기준 지수 감쇠로 계산된다 — `Math.pow(2, -distDays / 30)`. anchorTime이 과거 시점이면 그 시점에 가까운 파편이 높은 점수를 받는다. `asOf` 파라미터를 전달하면 자동으로 anchorTime으로 변환되어 일반 recall 경로에서 처리된다. 최종 반환량은 `tokenBudget` 파라미터로 제어된다. js-tiktoken cl100k_base 인코더로 파편마다 토큰을 정확히 계산하여 예산 초과 시 잘라낸다. 기본 토큰 예산은 1000이다. `pageSize`와 `cursor` 파라미터로 결과를 페이지네이션할 수 있다.

recall에 `includeLinks: true`(기본값)가 설정되어 있으면 결과 파편들의 연결 파편을 1-hop 추가 조회한다. `linkRelationType` 파라미터로 특정 관계 유형만 포함할 수 있다 — 미지정 시 caused_by, resolved_by, related가 포함된다. 연결 파편 조회 한도는 `MEMORY_CONFIG.linkedFragmentLimit`(기본 10)이다.

---

## TTL 계층

파편은 사용 빈도에 따라 hot, warm, cold, permanent 네 개의 티어를 이동한다. MemoryConsolidator가 주기적으로 강등/승격을 처리한다. 다시 참조되면 hot으로 복귀한다.

![파편 생명주기](assets/images/fragment_lifecycle.svg)

| Tier | 설명 |
|------|------|
| hot | 최근 생성되었거나 접근 빈도가 높은 파편 |
| warm | 기본 계층. 대부분의 장기 기억이 여기 있다 |
| cold | 오랫동안 접근되지 않은 파편. 다음 유지보수 사이클의 삭제 후보 |
| permanent | 감쇠, TTL 강등, 만료 삭제 전부 면제 |

`scope: "session"`으로 저장된 파편은 세션 워킹 메모리에 해당한다. 세션 종료 시 소멸한다. `scope: "permanent"`는 기본값이다.

`isAnchor: true`로 표시된 파편은 어느 계층에 있든 MemoryConsolidator의 감쇠 및 삭제 대상에서 영구적으로 제외된다. 중요도가 0.1이더라도 삭제되지 않는다. 절대 잃어서는 안 되는 지식에 사용한다.

stale 기준(일): procedure=30, fact=60, decision=90, default=60. `config/memory.js`의 `MEMORY_CONFIG.staleThresholds`에서 조정한다.

---

## MCP 도구

`lib/tools/memory.js`에 정의되며 `lib/tool-registry.js`를 통해 등록된다. db_query, db_tables, db_schema 등 DB 직접 접근 도구는 내부 유틸리티로만 사용되며 MCP 클라이언트에 노출되지 않는다.

---

### remember

지식을 파편으로 저장한다. 1~3문장의 원자적 단위가 이상적이다. 내용이 이미 존재한다면(content_hash 기준) 중복 저장을 거부한다. FragmentFactory가 저장 전 PII를 마스킹한다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| content | string | Y | 기억할 내용. 300자 이내 권장 |
| topic | string | Y | 주제 레이블 (예: database, deployment, error-handling) |
| type | string | Y | fact / decision / error / preference / procedure / relation |
| keywords | string[] | | 검색 키워드. 미입력 시 content에서 자동 추출 |
| importance | number | | 중요도 0.0~1.0. 미입력 시 type별 기본값 적용. 저장 시 타입별 상한이 적용된다: error/procedure 0.6, fact/decision/relation 0.7, preference 0.9. is_anchor=true 파편은 상한 없음. 내용 20자 미만이면 상한 0.2 |
| source | string | | 출처 식별자 (세션 ID, 도구명, 파일 경로 등) |
| linkedTo | string[] | | 저장 시점에 즉시 연결할 기존 파편 ID 목록 |
| scope | string | | permanent(기본) / session |
| isAnchor | boolean | | true 시 감쇠 및 만료 삭제 면제 |
| supersedes | string[] | | 대체할 기존 파편 ID 목록. 지정된 파편에 superseded_by 링크를 생성하고 valid_to를 설정하며 importance를 반감한다 |
| agentId | string | | 에이전트 ID. RLS 격리 컨텍스트 설정에 사용 |

반환값: `{ success: true, id: "...", created: true/false }`. created가 false면 기존 파편이 반환된 것이다(중복).

저장 후 EmbeddingWorker가 비동기로 임베딩을 생성하고, 완료 시 GraphLinker가 같은 topic의 유사 파편(similarity > 0.7)과 자동으로 링크를 생성한다. 링크 유형은 규칙 기반으로 결정된다: 같은 유형 + 높은 유사도(> 0.85)이면 `superseded_by`, error 유형 간 해결 관계이면 `resolved_by`, 그 외에는 `related`. 최대 3개까지 자동 생성된다. 임베딩 생성과 자동 링크는 remember 응답과 비동기로 분리되어 있으므로 응답 시간에 영향을 주지 않는다.

---

### recall

저장된 파편을 검색한다. 키워드, 주제, 유형, 자연어 쿼리를 단독 또는 조합하여 사용할 수 있다.

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| keywords | string[] | L1 Redis Set 교집합 검색에 사용될 키워드 |
| topic | string | 특정 주제로 결과 범위 제한 |
| type | string | 특정 유형으로 결과 범위 제한 |
| text | string | 자연어 쿼리. L3 벡터 검색을 강제 발동하고 L2+L3 병렬 실행 후 RRF 병합 |
| tokenBudget | number | 최대 반환 토큰 수. 기본 1000. cl100k_base 기준 |
| includeLinks | boolean | 연결 파편 1-hop 포함 여부. 기본 true |
| linkRelationType | string | caused_by / resolved_by / related / part_of / contradicts |
| threshold | number | L3 코사인 유사도 하한 (0.0~1.0). 이 값 미만의 벡터 검색 결과 제외 |
| asOf | string | ISO 8601 날짜시간 (예: "2026-01-15T00:00:00Z"). anchorTime으로 변환되어 해당 시점 근접 파편이 우선 배치된다 |
| includeSuperseded | boolean | true 시 valid_to가 설정된(만료된) 파편도 포함. 기본 false — superseded_by로 대체된 파편은 기본적으로 검색에서 제외된다 |
| cursor | string | 페이지네이션 커서. 이전 결과의 nextCursor 값을 전달하면 다음 페이지 반환 |
| pageSize | number | 페이지 크기. 기본 20, 최대 50 |
| agentId | string | 에이전트 ID |

---

### forget

파편을 삭제한다. permanent 계층 파편은 force 옵션 없이 삭제되지 않는다.

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| id | string | 단일 파편 삭제. ID로 지정 |
| topic | string | 특정 주제의 파편 전체 삭제 |
| force | boolean | permanent 파편 강제 삭제 허용. 기본 false |
| agentId | string | 에이전트 ID |

id와 topic 중 하나는 있어야 한다. 둘 다 있으면 id가 우선한다.

---

### link

두 파편 사이에 명시적 관계를 설정한다. fragment_links 테이블에 기록되며 linked_to 배열도 갱신된다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| fromId | string | Y | 출발 파편 ID |
| toId | string | Y | 도착 파편 ID |
| relationType | string | | related / caused_by / resolved_by / part_of / contradicts. 기본 related |
| agentId | string | | 에이전트 ID |

에러 파편과 해결 절차 파편 사이에 `resolved_by` 링크를 걸어두면 graph_explore가 인과 체인을 추적할 수 있다.

---

### amend

기존 파편의 내용이나 메타데이터를 수정한다. 수정 전 상태는 fragment_versions에 보존된다. ID와 fragment_links는 유지된다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| id | string | Y | 수정 대상 파편 ID |
| content | string | | 새 내용. 300자 초과 시 절삭 |
| topic | string | | 새 주제 |
| keywords | string[] | | 새 키워드 목록 |
| type | string | | 새 유형 |
| importance | number | | 새 중요도 0.0~1.0 |
| isAnchor | boolean | | 고정 여부 변경 |
| supersedes | boolean | | true 시 이 파편이 이전 파편을 명시적으로 대체함을 표시. superseded_by 링크를 생성하고 이전 파편의 중요도를 하향 조정 |
| agentId | string | | 에이전트 ID |

---

### reflect

세션 종료 시 대화 전체를 구조화된 파편 집합으로 변환하여 영속화한다. 핵심 결정, 에러 해결, 새 절차, 미해결 질문을 각각 별도 파편으로 저장한다. summary 하나만 있어도 동작하지만, decisions/errors_resolved/new_procedures/open_questions가 있으면 각각 decision/error/procedure/fact 타입 파편으로 개별 저장된다.

sessionId를 전달하면 해당 세션의 기존 파편(Redis frag:sess, Working Memory)만 종합하여 미입력 항목을 자동 채운다. summary 없이 sessionId만으로 호출 가능하다.

수동 호출 외에, 세션 종료/만료/서버 셧다운 시 AutoReflect가 자동으로 실행된다. Gemini CLI가 가용하면 SessionActivityTracker의 활동 로그를 기반으로 구조화된 요약을 생성하고, CLI가 불가하면 메타데이터(소요시간, 도구 사용 통계, 파편 수) 기반의 최소 fact 파편을 생성한다. AI가 수동으로 reflect를 호출한 세션은 자동 reflect를 건너뛴다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| summary | string | | 세션 전체 요약. sessionId만 있으면 세션 파편에서 자동 생성 |
| sessionId | string | | 세션 ID. 전달 시 같은 세션의 파편만 종합하여 reflect 수행 |
| decisions | string[] | | 이 세션에서 확정된 기술/아키텍처 결정 목록 |
| errors_resolved | string[] | | 해결한 에러 목록. "에러 설명 + 해결 방법" 형식 권장 |
| new_procedures | string[] | | 이 세션에서 확립된 새 절차/워크플로우 목록 |
| open_questions | string[] | | 미해결 질문 또는 후속 작업 목록 |
| agentId | string | | 에이전트 ID |
| task_effectiveness | object | | 세션 도구 사용 효과성 종합. `{ overall_success: boolean, tool_highlights: string[], tool_pain_points: string[] }` |

---

### context

세션 시작 시 기억 시스템에서 맥락을 복원한다. Core Memory(중요도 높은 고정 파편)와 Working Memory(현재 세션의 파편)를 분리 로드한다. Core Memory는 파편 수 상한(기본 15개)과 유형별 슬롯 제한(preference:5, error:5, procedure:5, decision:3, fact:3)으로 3중 제어된다 — 토큰 예산 내에서도 특정 유형이 전체를 점유하지 못한다. Working Memory도 파편 수 상한(기본 10개)이 적용된다. 미반영(unreflected) 세션이 존재하면 injectionText에 `[SYSTEM HINT]`로 세션 수를 알려준다.

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| tokenBudget | number | 최대 반환 토큰 수. 기본 2000 |
| types | string[] | 로드할 유형 목록. 기본: ["preference", "error", "procedure"] |
| sessionId | string | 워킹 메모리 조회용 세션 ID |
| agentId | string | 에이전트 ID |

---

### tool_feedback

도구 사용 결과의 유용성을 평가한다. recall이나 다른 도구의 결과가 기대와 크게 다를 때 호출한다. 피드백은 tool_feedback 테이블에 기록되며 장기적으로 검색 품질 개선에 사용된다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| tool_name | string | Y | 평가 대상 도구명 |
| relevant | boolean | Y | 결과가 요청 의도와 관련 있었는가 |
| sufficient | boolean | Y | 결과가 작업 완료에 충분했는가 |
| suggestion | string | | 개선 제안. 100자 이내 권장 |
| context | string | | 사용 맥락 요약. 50자 이내 권장 |
| session_id | string | | 세션 ID |
| trigger_type | string | | sampled(훅이 샘플링하여 요청) / voluntary(AI가 자발적으로 호출, 기본) |

---

### memory_stats

기억 시스템의 현재 상태를 조회한다. 전체 파편 수, TTL 계층별 분포, 유형별 통계, 임베딩 생성 비율 등. 파라미터 없음.

응답에 `searchLatencyMs` 키가 포함된다. L1(Redis)/L2(PostgreSQL)/L3(pgvector)/total 레이어별 최근 100회 검색의 P50/P90/P99 지연 시간(ms)을 반환한다.

```json
"searchLatencyMs": {
  "L1":    { "p50": 0,   "p90": 1,   "p99": 7,   "count": 26 },
  "L2":    { "p50": 4,   "p90": 175, "p99": 595, "count": 26 },
  "L3":    { "p50": 159, "p90": 595, "p99": 595, "count": 10 },
  "total": { "p50": 8,   "p90": 177, "p99": 597, "count": 26 }
}
```

응답에 `evaluation` 키도 포함된다. `tool_feedback`/`task_feedback`를 implicit ground truth로 사용한 IR 품질 지표다.

| 필드 | 설명 |
|------|------|
| `rolling_precision_at_5` | 최근 100 세션의 recall Precision@5 이동 평균. `relevant=true` 비율로 근사 |
| `sufficient_rate` | `sufficient=true` 비율 (0~1) |
| `sample_sessions` | 평가에 사용된 세션 수 |
| `task_success_rate` | `task_feedback.overall_success` 비율 (30일 윈도우) |
| `task_sessions` | 평가에 사용된 task 세션 수 |

---

### memory_consolidate

18단계 유지보수 파이프라인을 수동으로 실행한다. 서버 내부에서 6시간 간격으로 자동 실행되지만 수동 호출도 가능하다. 파라미터 없음.

---

### graph_explore

에러 파편을 기점으로 인과 관계 체인을 추적한다. RCA(Root Cause Analysis) 전용 도구. caused_by, resolved_by 관계를 1-hop 추적하여 에러의 원인과 해결 절차를 연결된 그래프로 반환한다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| startId | string | Y | 시작 파편 ID. error 타입 파편 권장 |
| agentId | string | | 에이전트 ID |

---

### fragment_history

파편의 전체 변경 이력과 대체 체인을 조회한다. amend로 수정된 이전 버전(fragment_versions)과 superseded_by 링크 체인을 반환한다. "이 파편이 언제, 무엇으로 대체되었는가?"를 추적할 때 사용한다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| id | string | Y | 조회 대상 파편 ID |
| agentId | string | | 에이전트 ID |

반환값: `{ current, versions, superseded_by_chain }`. current는 현재 파편 상태, versions는 amend 이전 버전 배열(최신순), superseded_by_chain은 이 파편을 대체한 후속 파편 배열이다.

---

## 권장 사용 흐름

1. 세션 시작 — `context()`로 핵심 기억을 로드한다. 선호, 에러 패턴, 절차가 복원된다. 미반영 세션이 있으면 힌트가 표시된다.
2. 작업 중 — 중요한 결정, 에러, 절차 발생 시 `remember()`로 저장한다. 저장 시 유사 파편과 자동으로 링크가 생성된다. 과거 경험이 필요하면 `recall()`로 검색한다. 에러 해결 후 `forget()`으로 에러 파편을 정리하고 `remember()`로 해결 절차를 기록한다.
3. 세션 종료 — `reflect()`로 세션 내용을 구조화된 파편으로 영속화한다. 수동 호출 없이도 세션 종료/만료 시 AutoReflect가 자동으로 실행된다.

---

## MemoryEvaluator

서버가 시작되면 MemoryEvaluator 워커가 백그라운드에서 구동된다. `getMemoryEvaluator().start()`로 시작되는 싱글턴이다. SIGTERM/SIGINT 수신 시 graceful shutdown 흐름에서 중지된다.

워커는 5초 간격으로 Redis 큐 `memory_evaluation`을 폴링한다. 큐가 비어 있으면 대기한다. 큐에서 잡(job)을 꺼내면 Gemini CLI(`geminiCLIJson`)를 호출하여 파편 내용의 합리성을 평가한다. 평가 결과는 fragments 테이블의 utility_score와 verified_at을 갱신하는 데 사용된다.

새 파편이 remember로 저장될 때 평가 큐에 자동으로 투입된다. 평가는 저장과 비동기로 분리되어 있으므로 remember 호출의 응답 시간에 영향을 주지 않는다.

Gemini CLI가 설치되지 않은 환경에서는 워커가 구동되지만 평가 작업을 건너뛴다.

---

## MemoryConsolidator

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

---

## MEMORY_CONFIG

`config/memory.js`에 정의된 설정 파일. 랭킹 가중치와 stale 임계값을 서버 코드 수정 없이 조정할 수 있다.

```js
export const MEMORY_CONFIG = {
  ranking: {
    importanceWeight    : 0.4,   // 시간-의미 복합 랭킹에서 중요도 가중치
    recencyWeight       : 0.3,   // 시간 근접도 가중치 (anchorTime 기준 지수 감쇠)
    semanticWeight      : 0.3,   // 시맨틱 유사도 가중치
    activationThreshold : 0,     // 항상 복합 랭킹 적용
    recencyHalfLifeDays : 30,    // 시간 근접도 반감기 (일)
  },
  staleThresholds: {
    procedure: 30,   // 절차 파편의 stale 기준 (일)
    fact      : 60,  // 사실 파편의 stale 기준 (일)
    decision  : 90,  // 결정 파편의 stale 기준 (일)
    default   : 60   // 나머지 유형의 stale 기준 (일)
  },
  halfLifeDays: {
    procedure : 30,  // 감쇠 반감기 — 중요도가 절반이 되는 기간 (일)
    fact      : 60,
    decision  : 90,
    error     : 45,
    preference: 120,
    relation  : 90,
    default   : 60
  },
  rrfSearch: {
    k             : 60,   // RRF 분모 상수. 값이 클수록 상위 랭크 의존도 완화
    l1WeightFactor: 2.0   // L1 Redis 결과에 곱하는 가중치 배수 (최우선 주입)
  },
  linkedFragmentLimit: 10,  // recall의 includeLinks 시 1-hop 연결 파편 최대 수
  embeddingWorker: {
    batchSize      : 10,      // 1회 처리 건수
    intervalMs     : 5000,    // 폴링 간격 (ms)
    retryLimit     : 3,       // 실패 시 재시도 횟수
    retryDelayMs   : 2000,    // 재시도 간격 (ms)
    queueKey       : "memento:embedding_queue"
  },
  contextInjection: {
    maxCoreFragments   : 15,     // Core Memory 최대 파편 수
    maxWmFragments     : 10,     // Working Memory 최대 파편 수
    typeSlots          : {       // 유형별 최대 슬롯
      preference : 5,
      error      : 5,
      procedure  : 5,
      decision   : 3,
      fact       : 3
    },
    defaultTokenBudget : 2000
  },
  pagination: {
    defaultPageSize : 20,
    maxPageSize     : 50
  },
  gc: {
    utilityThreshold       : 0.15,   // 이 값 미만 + 비활성 시 삭제 후보
    gracePeriodDays        : 7,      // 최소 생존 기간 (일)
    inactiveDays           : 60,     // 비활성 기간 (일)
    maxDeletePerCycle      : 50,     // 1회 최대 삭제 건수
    factDecisionPolicy     : {
      importanceThreshold  : 0.2,    // fact/decision GC 기준 중요도
      orphanAgeDays        : 30      // 고립 fact/decision 삭제 기준 (일)
    },
    errorResolvedPolicy    : {
      maxAgeDays           : 30,     // [해결됨] error 파편 삭제 기준 (일)
      maxImportance        : 0.3     // 이 값 미만이면 삭제 대상
    }
  },
  reflectionPolicy: {
    maxAgeDays       : 30,       // session_reflect 파편 삭제 기준 (일)
    maxImportance    : 0.3,      // 이 값 미만이면 삭제 대상
    keepPerType      : 5,        // type별 최신 N개 보존
    maxDeletePerCycle: 30        // 1회 최대 삭제 건수
  },
  semanticSearch: {
    minSimilarity: 0.2,          // L3 pgvector 검색 최소 유사도 (기본 0.2)
    limit        : 10            // L3 반환 최대 건수
  }
};
```

importanceWeight + recencyWeight + semanticWeight의 합은 1.0이어야 한다. halfLifeDays는 감쇠의 속도를 결정하며 staleThresholds와 독립적으로 동작한다. rrfSearch.k는 RRF 점수의 분모 안정화 상수로, 60이 일반 용도 기본값이다. gc.factDecisionPolicy는 fact/decision 유형의 고립 파편을 별도 기준으로 정리하여 검색 노이즈를 줄인다.

---

## 환경 변수

### 서버

| 변수 | 기본값 | 설명 |
|------|--------|------|
| PORT | 57332 | HTTP 리슨 포트 |
| MEMENTO_ACCESS_KEY | (없음) | Bearer 인증 키. 미설정 시 인증 비활성화 |
| SESSION_TTL_MINUTES | 60 | 세션 유효 시간 (분) |
| LOG_DIR | /var/log/mcp | Winston 로그 파일 저장 디렉토리 |
| ALLOWED_ORIGINS | (없음) | 허용할 Origin 목록. 쉼표로 구분. 미설정 시 전체 허용 |
| RATE_LIMIT_WINDOW_MS | 60000 | Rate limiting 윈도우 크기 (ms) |
| RATE_LIMIT_MAX_REQUESTS | 120 | 윈도우 내 IP당 최대 요청 수 |
| CONSOLIDATE_INTERVAL_MS | 21600000 | 자동 유지보수(consolidate) 실행 간격 (ms). 기본 6시간 |
| OAUTH_ALLOWED_REDIRECT_URIS | (없음) | OAuth redirect_uri 허용 prefix (쉼표 구분, 미설정 시 localhost만 허용) |

### PostgreSQL

POSTGRES_* 접두어가 DB_* 접두어보다 우선한다. 두 형식을 혼용할 수 있다.

| 변수 | 설명 |
|------|------|
| POSTGRES_HOST / DB_HOST | 호스트 주소 |
| POSTGRES_PORT / DB_PORT | 포트 번호. 기본 5432 |
| POSTGRES_DB / DB_NAME | 데이터베이스 이름 |
| POSTGRES_USER / DB_USER | 접속 사용자 |
| POSTGRES_PASSWORD / DB_PASSWORD | 접속 비밀번호 |
| DB_MAX_CONNECTIONS | 연결 풀 최대 연결 수. 기본 20 |
| DB_IDLE_TIMEOUT_MS | 유휴 연결 반환 대기 시간 ms. 기본 30000 |
| DB_CONN_TIMEOUT_MS | 연결 획득 타임아웃 ms. 기본 10000 |
| DB_QUERY_TIMEOUT | 쿼리 타임아웃 ms. 기본 30000 |

### Redis

| 변수 | 기본값 | 설명 |
|------|--------|------|
| REDIS_ENABLED | false | Redis 활성화. false면 L1 검색과 캐싱이 비활성화 |
| REDIS_SENTINEL_ENABLED | false | Sentinel 모드 사용 |
| REDIS_HOST | localhost | Redis 서버 호스트 |
| REDIS_PORT | 6379 | Redis 서버 포트 |
| REDIS_PASSWORD | (없음) | Redis 인증 비밀번호 |
| REDIS_DB | 0 | Redis 데이터베이스 번호 |
| REDIS_MASTER_NAME | mymaster | Sentinel 마스터 이름 |
| REDIS_SENTINELS | localhost:26379, localhost:26380, localhost:26381 | Sentinel 노드 목록. 쉼표로 구분된 host:port 형식 |

### 캐싱

| 변수 | 기본값 | 설명 |
|------|--------|------|
| CACHE_ENABLED | REDIS_ENABLED 값과 동일 | 쿼리 결과 캐싱 활성화 |
| CACHE_DB_TTL | 300 | DB 쿼리 결과 캐시 TTL (초) |
| CACHE_SESSION_TTL | SESSION_TTL_MS / 1000 | 세션 캐시 TTL (초) |

### AI

| 변수 | 기본값 | 설명 |
|------|--------|------|
| OPENAI_API_KEY | (없음) | OpenAI API 키. `EMBEDDING_PROVIDER=openai` 시 사용 |
| EMBEDDING_PROVIDER | openai | 임베딩 provider. `openai` \| `gemini` \| `ollama` \| `localai` \| `custom` |
| EMBEDDING_API_KEY | (없음) | 범용 임베딩 API 키. 미설정 시 `OPENAI_API_KEY` 사용 |
| EMBEDDING_BASE_URL | (없음) | `EMBEDDING_PROVIDER=custom` 시 OpenAI 호환 엔드포인트 URL |
| EMBEDDING_MODEL | (provider 기본값) | 사용할 임베딩 모델. 생략 시 provider별 기본값 자동 적용 |
| EMBEDDING_DIMENSIONS | (provider 기본값) | 임베딩 벡터 차원 수. DB 스키마의 vector 차원과 일치해야 한다 |
| EMBEDDING_SUPPORTS_DIMS_PARAM | (provider 기본값) | dimensions 파라미터 지원 여부 override (`true`\|`false`) |
| GEMINI_API_KEY | (없음) | Google Gemini API 키. `EMBEDDING_PROVIDER=gemini` 시 사용 |

---

## 임베딩 Provider 전환

`EMBEDDING_PROVIDER` 환경변수 하나로 provider를 전환할 수 있다. model, dimensions, base URL은 provider 기본값으로 자동 결정되며, 필요 시 개별 환경변수로 override 가능하다.

임베딩은 L3 시맨틱 검색과 자동 링크 생성에 사용된다.

> 차원 변경 시 주의: `EMBEDDING_DIMENSIONS`를 바꾸면 PostgreSQL 스키마도 변경해야 한다. `node lib/memory/migration-007-flexible-embedding-dims.js`와 `node lib/memory/backfill-embeddings.js`를 순서대로 실행할 것.

---

### OpenAI (기본값)

```env
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

| 모델 | 차원 | 특징 |
|------|------|------|
| text-embedding-3-small | 1536 | 기본값. 비용 효율적 |
| text-embedding-3-large | 3072 | 고정밀. 비용 2배 |
| text-embedding-ada-002 | 1536 | 레거시 호환 |

---

### Google Gemini

`text-embedding-004`는 2026년 1월 14일 종료. 현재 권장 모델은 `gemini-embedding-001` (3072차원)이다.

```env
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=AIza...
```

3072차원은 기본 스키마(1536)와 다르므로 최초 전환 시 migration-007 실행 필요:

```bash
EMBEDDING_DIMENSIONS=3072 DATABASE_URL=$DATABASE_URL \
  node lib/memory/migration-007-flexible-embedding-dims.js
DATABASE_URL=$DATABASE_URL node lib/memory/backfill-embeddings.js
```

> halfvec 타입은 pgvector 0.7.0 이상에서 지원한다. 버전 확인: `SELECT extversion FROM pg_extension WHERE extname = 'vector';`

| 모델 | 차원 | 특징 |
|------|------|------|
| gemini-embedding-001 | 3072 | 현행 권장 모델. 고정밀 |
| text-embedding-004 | 768 | 2026-01-14 종료 |

---

### Ollama (로컬)

Ollama가 `http://localhost:11434`에서 실행 중이어야 한다.

```env
EMBEDDING_PROVIDER=ollama
# EMBEDDING_MODEL=nomic-embed-text  # 기본값
```

```bash
# 모델 다운로드
ollama pull nomic-embed-text
ollama pull mxbai-embed-large
```

| 모델 | 차원 | 특징 |
|------|------|------|
| nomic-embed-text | 768 | 8192 토큰 컨텍스트, MTEB 고성능 |
| mxbai-embed-large | 1024 | 512 컨텍스트, 경쟁력 있는 MTEB 점수 |
| all-minilm | 384 | 초경량, 로컬 테스트에 적합 |

---

### LocalAI (로컬)

```env
EMBEDDING_PROVIDER=localai
```

---

### 커스텀 OpenAI 호환 서버

LM Studio, llama.cpp 등 임의의 OpenAI 호환 서버를 사용할 때 지정한다.

```env
EMBEDDING_PROVIDER=custom
EMBEDDING_BASE_URL=http://my-server:8080/v1
EMBEDDING_API_KEY=my-key
EMBEDDING_MODEL=my-model
EMBEDDING_DIMENSIONS=1024
```

---

### 상용 API (커스텀 어댑터 필요)

Cohere, Voyage AI, Mistral, Jina AI, Nomic은 OpenAI SDK와 호환되지 않거나 별도의 API 구조를 가진다. `lib/tools/embedding.js`의 `generateEmbedding` 함수를 아래 예시로 교체한다.

#### Cohere

```bash
npm install cohere-ai
```

```js
// lib/tools/embedding.js — generateEmbedding 교체
import { CohereClient } from "cohere-ai";

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

export async function generateEmbedding(text) {
  const res = await cohere.v2.embed({
    model:          "embed-v4.0",
    inputType:      "search_document",
    embeddingTypes: ["float"],
    texts:          [text]
  });
  return normalizeL2(res.embeddings.float[0]);
}
```

```env
COHERE_API_KEY=...
EMBEDDING_DIMENSIONS=1536
```

| 모델 | 차원 | 특징 |
|------|------|------|
| embed-v4.0 | 1536 | 최신, 다국어 지원 |
| embed-multilingual-v3.0 | 1024 | 레거시 다국어 |

---

#### Voyage AI

```js
// lib/tools/embedding.js — generateEmbedding 교체
export async function generateEmbedding(text) {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type":  "application/json"
    },
    body: JSON.stringify({ model: "voyage-3.5", input: [text] })
  });
  const data = await res.json();
  return normalizeL2(data.data[0].embedding);
}
```

```env
VOYAGE_API_KEY=...
EMBEDDING_DIMENSIONS=1024
```

| 모델 | 차원 | 특징 |
|------|------|------|
| voyage-3.5 | 1024 | 최고 정확도 |
| voyage-3.5-lite | 512 | 저비용, 빠름 |
| voyage-code-3 | 1024 | 코드 특화 |

---

#### Mistral AI

OpenAI SDK 호환이므로 `baseURL`만 교체하면 된다.

```js
// lib/tools/embedding.js — generateEmbedding 교체
import OpenAI from "openai";

const client = new OpenAI({
  apiKey:  process.env.MISTRAL_API_KEY,
  baseURL: "https://api.mistral.ai/v1"
});

export async function generateEmbedding(text) {
  const res = await client.embeddings.create({
    model: "mistral-embed",
    input: [text]
  });
  return normalizeL2(res.data[0].embedding);
}
```

```env
MISTRAL_API_KEY=...
EMBEDDING_DIMENSIONS=1024
```

---

#### Jina AI

무료 플랜: 100 RPM / 1M 토큰/월.

```js
// lib/tools/embedding.js — generateEmbedding 교체
export async function generateEmbedding(text) {
  const res = await fetch("https://api.jina.ai/v1/embeddings", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${process.env.JINA_API_KEY}`,
      "Content-Type":  "application/json"
    },
    body: JSON.stringify({
      model: "jina-embeddings-v3",
      task:  "retrieval.passage",
      input: [text]
    })
  });
  const data = await res.json();
  return normalizeL2(data.data[0].embedding);
}
```

```env
JINA_API_KEY=...
EMBEDDING_DIMENSIONS=1024
```

| 모델 | 차원 | 특징 |
|------|------|------|
| jina-embeddings-v3 | 1024 | MRL 지원 (32~1024 유동 차원) |
| jina-embeddings-v2-base-en | 768 | 영어 특화 |

---

#### Nomic

무료 플랜: 월 1M 토큰. OpenAI SDK 호환이므로 `baseURL` 변경으로 적용 가능하다.

```js
// lib/tools/embedding.js — generateEmbedding 교체
import OpenAI from "openai";

const client = new OpenAI({
  apiKey:  process.env.NOMIC_API_KEY,
  baseURL: "https://api-atlas.nomic.ai/v1"
});

export async function generateEmbedding(text) {
  const res = await client.embeddings.create({
    model: "nomic-embed-text-v1.5",
    input: [text]
  });
  return normalizeL2(res.data[0].embedding);
}
```

```env
NOMIC_API_KEY=...
EMBEDDING_DIMENSIONS=768
```

---

### 서비스 비교

| 서비스 | 차원 | 설정 방법 | 무료 플랜 |
|--------|------|-----------|-----------|
| OpenAI text-embedding-3-small | 1536 | `EMBEDDING_PROVIDER=openai` | 없음 |
| OpenAI text-embedding-3-large | 3072 | `EMBEDDING_PROVIDER=openai` | 없음 |
| Google Gemini gemini-embedding-001 | 3072 | `EMBEDDING_PROVIDER=gemini` | 있음 (제한적) |
| Ollama (nomic-embed-text) | 768 | `EMBEDDING_PROVIDER=ollama` | 완전 무료 (로컬) |
| Ollama (mxbai-embed-large) | 1024 | `EMBEDDING_PROVIDER=ollama` | 완전 무료 (로컬) |
| LocalAI | 가변 | `EMBEDDING_PROVIDER=localai` | 완전 무료 (로컬) |
| 커스텀 호환 서버 | 가변 | `EMBEDDING_PROVIDER=custom` | — |
| Cohere embed-v4.0 | 1536 | 코드 교체 | 없음 |
| Voyage AI voyage-3.5 | 1024 | 코드 교체 | 없음 |
| Mistral mistral-embed | 1024 | 코드 교체 | 없음 |
| Jina jina-embeddings-v3 | 1024 | 코드 교체 | 있음 (1M/월) |
| Nomic nomic-embed-text-v1.5 | 768 | 코드 교체 | 있음 (1M/월) |

---

## HTTP 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | /mcp | Streamable HTTP. JSON-RPC 요청 수신. MCP-Session-Id 헤더 필요 (초기 initialize 제외) |
| GET | /mcp | Streamable HTTP. SSE 스트림 열기. 서버 측 푸시용 |
| DELETE | /mcp | Streamable HTTP. 세션 명시적 종료 |
| GET | /sse | Legacy SSE. 세션 생성. `accessKey` 쿼리 파라미터로 인증 |
| POST | /message?sessionId= | Legacy SSE. JSON-RPC 요청 수신. 응답은 SSE 스트림으로 전달 |
| GET | /health | 헬스 체크. DB 쿼리(SELECT 1), 세션 상태, Redis 연결을 확인하고 JSON으로 반환. `REDIS_ENABLED=false` 시 Redis는 `disabled`로 표시되며 200 반환. DB 장애 시 503 |
| GET | /metrics | Prometheus 메트릭. prom-client가 수집한 HTTP 요청 카운터, 세션 게이지 등 |
| GET | /.well-known/oauth-authorization-server | OAuth 2.0 인가 서버 메타데이터 |
| GET | /.well-known/oauth-protected-resource | OAuth 2.0 보호 리소스 메타데이터 |
| GET | /authorize | OAuth 2.0 인가 엔드포인트. PKCE code_challenge 필요 |
| POST | /token | OAuth 2.0 토큰 엔드포인트. authorization_code 교환 |
| GET | /v1/internal/model/nothing | Admin SPA. 로그인 폼을 포함한 정적 HTML 제공(인증 불필요). 데이터 API는 마스터 키 인증 필요 |
| POST | /v1/internal/model/nothing/auth | 마스터 키 검증 엔드포인트 |
| GET | /v1/internal/model/nothing/stats | 대시보드 통계 (파편 수, API 호출량, 시스템 메트릭) |
| GET | /v1/internal/model/nothing/activity | 최근 파편 활동 로그 (10건) |
| GET | /v1/internal/model/nothing/keys | API 키 목록 조회 |
| POST | /v1/internal/model/nothing/keys | API 키 생성. 원시 키는 응답에서 단 1회 반환 |
| PUT | /v1/internal/model/nothing/keys/:id | API 키 상태 변경 (active ↔ inactive) |
| DELETE | /v1/internal/model/nothing/keys/:id | API 키 삭제 |

인증 방식은 두 가지다. Streamable HTTP는 `initialize` 요청 시 `Authorization: Bearer <MEMENTO_ACCESS_KEY>` 헤더로 인증하며 이후 세션으로 유지된다. Legacy SSE는 `/sse?accessKey=<MEMENTO_ACCESS_KEY>` 쿼리 파라미터로 인증한다.

---

## 기술 스택

- Node.js 20+
- PostgreSQL 14+ (pgvector 확장)
- Redis 6+ (선택)
- OpenAI Embedding API (선택)
- Gemini CLI (품질 평가, 모순 에스컬레이션, 자동 reflect 요약 생성용, 선택)
- @huggingface/transformers + ONNX Runtime (NLI 모순 분류, CPU 전용, 자동 설치)
- MCP Protocol 2025-11-25

PostgreSQL만 있으면 핵심 기능이 동작한다. Redis를 추가하면 L1 캐스케이드 검색과 SessionActivityTracker가 활성화되고, OpenAI API를 추가하면 L3 시맨틱 검색과 자동 링크가 활성화된다. NLI 모델은 npm install 시 자동으로 포함되며, 최초 실행 시 ~280MB ONNX 모델을 다운로드한다(이후 캐싱). NLI만으로도 명확한 논리적 모순을 즉시 탐지하며, Gemini CLI를 추가하면 수치/도메인 모순까지 처리 범위가 확장된다. 각 구성 요소는 독립적으로 활성화/비활성화할 수 있다.

---

## 테스트

### 전체 테스트 (DB 불필요)
```bash
npm test          # Jest + unit + integration 순차 실행
```

개별 실행:
```bash
npm run test:jest        # Jest — tests/*.test.js
npm run test:unit        # node:test — tests/unit/*.test.js
npm run test:integration # node:test — tests/integration/*.test.js
```

### E2E 테스트 (PostgreSQL 필요)

로컬 Docker 환경 (권장):
```bash
npm run test:e2e:local   # docker-compose로 테스트 DB 기동 후 실행
```

기존 DB 연결 사용:
```bash
DATABASE_URL=postgresql://user:pass@host:port/db npm run test:e2e
```

### CI 전체 (DB 필요)
```bash
npm run test:ci          # npm test + test:e2e
```

---

## 설치

설치, 마이그레이션, Claude Code 연결, 훅 설정은 **[INSTALL.md](INSTALL.md)**를 참조한다.

---

## 만들게 된 계기

실무에서 AI를 쓰면서 매일 같은 맥락을 반복 설명하는 비효율을 느꼈다. 시스템 프롬프트에 메모를 넣는 방법도 써봤지만 한계가 명확했다. 파편 수가 늘어나면 관리가 안 되고, 검색이 안 되고, 오래된 정보와 새 정보가 충돌했다.

이미 설명한 것, 이미 세팅한 것을 무한히 반복하게 만드는 것이 가장 큰 문제였다. 인증 정보가 없다고 해서 보면 있고, 세팅 안 돼 있다고 해서 파일을 직접 열어보면 다 돼 있다. 철저하게 논파해서 말 잘 듣게 해 봐야 그때뿐이다. 세션을 다시 시작하면 같은 일이 또 반복된다. 명문대를 수석 졸업했지만 매일 뇌가 리셋되는 신입사원의 교육담당자가 된 기분이었다.

이 고충을 해소하기 위해 기억을 원자 단위로 분해하고, 계층적으로 검색하고, 시간에 따라 자연스럽게 망각하는 시스템을 설계했다. 인간이 망각의 동물인 것처럼, 이 시스템은 "적절한 망각"을 포함한 기억을 지향한다.

---

기억은 지능의 전제가 아니다. 기억은 지능의 조건이다. 체스를 두는 방법을 알아도, 어제 진 게임을 기억하지 못하면 같은 수를 또 둔다. 모든 언어를 구사해도, 어제 나눈 대화를 기억하지 못하면 매번 처음 만나는 사람이 된다. 수십억 개의 파라미터로 세상 모든 지식을 담아도, 당신과 함께한 어제를 기억하지 못하면 낯선 박식가일 뿐이다.

기억이 있어야 관계가 있다. 관계가 있어야 신뢰가 있다.

기억은 사라지지 않는다. 다만 cold tier로 내려갈 뿐이다. 그리고 충분히 오래 방치된 cold 파편은 다음 consolidate 사이클에서 소멸한다. 이것은 설계이지 버그가 아니다. 쓸모없어진 기억은 자리를 비워야 한다. 아우구스티누스의 궁전에도 창고 정리는 필요하다.


멍청한 걸로 유명한 금붕어새기도 몇 달을 기억한다.

이제 당신의 AI도 그렇다.

---

<p align="center">
  Made by <a href="mailto:jinho.von.choi@nerdvana.kr">Jinho Choi</a> &nbsp;|&nbsp;
  <a href="https://buymeacoffee.com/jinho.von.choi">Buy me a coffee</a>
</p>
