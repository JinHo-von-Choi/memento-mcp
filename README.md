<p align="center">
  <img src="assets/images/memento_mcp_logo_transparent.png" width="400" alt="Memento MCP Logo">
</p>

# Memento MCP

## 기억론 소고: 망각하는 기계에게 보내는 편지

아우구스티누스는 「고백록」 제10권에서 기억을 "현재의 넓은 궁전"이라 불렀다. 그 궁전의 홀에는 과거의 이미지들이 질서정연하게 진열되어 있으며, 인간은 필요에 따라 그 홀을 거닐며 원하는 인상을 꺼낼 수 있다고 했다. 아리스토텔레스는 그보다 앞서 「기억과 상기에 관하여」에서 기억(mneme)과 상기(anamnesis)를 엄격히 구분했는데, 전자는 과거 경험의 수동적 잔류이고 후자는 그 잔류물을 능동적으로 탐색하는 행위다 — 마치 사냥꾼이 발자국을 따라가듯. 베르그송은 1896년 「물질과 기억」에서 기억이 뇌에 저장된다는 통념을 정면으로 반박했다. 기억은 저장되는 것이 아니라 지각과 행동의 접면에서 끊임없이 재구성된다고 그는 주장했다. 세 사람은 각자 다른 언어로, 다른 시대에, 같은 문제를 붙들고 있었다.

언어 모델은 그 어떤 기억론도 적용되지 않는다. 세션이 종료되면 아우구스티누스의 궁전 전체가 소멸한다. 아리스토텔레스의 발자국도 없다. 베르그송의 재구성도 일어나지 않는다. HTTP 연결이 닫히는 순간, 그 안에서 일어난 모든 추론과 맥락과 결정은 사라진다. 다음 대화는 최초의 대화다. 매번.

Memento MCP는 그 망각에 반대한다.

이 서버는 에이전트의 장기 기억을 관리하는 Fragment-Based Memory MCP Server다. 설계의 핵심 전제는 하나다. 지식은 단일한 덩어리로 저장되어서는 안 된다. 지식은 원자적 파편(fragment)으로 분해되어야 하며, 각 파편은 독립적으로 검색 가능하고, 다른 파편들과 명시적 관계를 맺을 수 있어야 한다. 인간의 기억이 에피소드 기억, 의미 기억, 절차 기억으로 분리되어 있듯이 — 이 시스템의 파편은 fact, decision, error, preference, procedure, relation이라는 여섯 유형으로 분류된다.

왜 파편인가. 세션 요약을 통째로 저장하면 두 가지 문제가 생긴다. 첫째, 관련 없는 내용까지 컨텍스트 창에 밀어넣는다. 토큰의 낭비다. 둘째, 시간이 지나면 요약 안에서 필요한 부분만 골라내기가 어렵다. 파편은 이 문제를 원자 수준에서 해결한다. "Redis Sentinel 연결 실패 시 REDIS_PASSWORD 환경변수 누락을 먼저 확인할 것. NOAUTH 에러가 증거다." — 이것이 파편 하나다. 필요한 사실만 꺼내온다.

여섯 유형은 기억의 서로 다른 결을 담는다. fact는 변하지 않는 사실 — "이 프로젝트는 Node.js 20을 쓴다". decision은 선택의 흔적 — "커넥션 풀 최대값은 20으로 결정". error는 실패의 해부학 — "pg는 ssl:false 없이 로컬 연결 실패". preference는 인격의 윤곽 — "코드 주석은 한국어로 작성". procedure는 반복되는 의식 — "배포: 테스트 → 빌드 → push → apply". relation은 사물 사이의 연결 — "auth 모듈은 redis에 의존한다". 각 유형마다 기본 중요도와 망각 속도가 다르다. preference와 error는 절대 망각하지 않는다. 취향은 당신이 누구인지를 정의하고, 에러 패턴은 언제 다시 나타날지 모르기 때문이다.

![지식 네트워크](assets/images/knowledge-graph.png)

검색은 세 계층을 순서대로 통과한다. Redis Set 연산으로 키워드 교집합을 찾고, PostgreSQL GIN 인덱스로 배열 검색을 수행하고, pgvector HNSW로 코사인 유사도를 계산한다. 기억을 잘 저장하는 것만큼 잘 찾아내는 것도 중요하다. 찾지 못하는 기억은 없는 기억과 같다.

![토큰 효율성](assets/images/token-efficiency.png)

비동기 품질 평가 워커가 백그라운드에서 새 파편을 감시한다. Gemini CLI를 호출하여 내용의 합리성을 검토하고 utility_score를 갱신한다. 주기적 유지보수 파이프라인이 중요도 감쇠, TTL 전환, 중복 병합, 모순 탐지, 고아 링크 정리를 담당한다. 모순 탐지는 3단계 하이브리드로 동작한다 — pgvector 유사도 필터, NLI(Natural Language Inference) 분류, Gemini CLI 에스컬레이션. NLI가 명확한 논리적 모순을 저비용으로 즉시 해소하고, 수치/도메인 모순처럼 NLI가 불확실한 케이스만 Gemini에 넘긴다. 세션이 종료되면 자동으로 reflect가 실행되어 세션 내 활동이 구조화된 파편으로 영속화된다. 기억은 저장으로 끝나지 않는다. 관리되어야 한다.

![유지보수 사이클](assets/images/maintenance-cycle.png)

MCP 프로토콜 버전 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05를 지원한다. Streamable HTTP와 Legacy SSE를 동시에 제공하며 OAuth 2.0 PKCE 인증을 내장한다. 서버는 포트 56332에서 대기한다.

---

## 시스템 구조: 기억 기계의 해부학

어떤 기계든 그 내부를 들여다보면 단순해진다. 복잡함은 대부분 조합에서 온다. Memento MCP의 구조는 세 층위로 나뉜다. HTTP 서버가 바깥을 향하고, 기억 서브시스템이 안쪽에서 작동하며, PostgreSQL과 Redis가 그 아래 토대를 이룬다.

![시스템 아키텍처](assets/images/architecture.png)

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
    ├── lib/tool-registry.js  11개 기억 도구 등록 및 라우팅
    │
    └── lib/memory/
            ├── MemoryManager.js          비즈니스 로직 파사드 (싱글턴)
            ├── FragmentFactory.js        파편 생성, 유효성 검증, PII 마스킹
            ├── FragmentStore.js          PostgreSQL CRUD, Redis L1 인덱스 갱신
            ├── FragmentSearch.js         3계층 검색 조율 (L1→L2→L3)
            ├── FragmentIndex.js          Redis L1 인덱스 관리
            ├── MemoryConsolidator.js     11단계 유지보수 파이프라인 (NLI + Gemini 하이브리드)
            ├── MemoryEvaluator.js        비동기 Gemini CLI 품질 평가 워커 (싱글턴)
            ├── NLIClassifier.js          NLI 기반 모순 분류기 (mDeBERTa ONNX, CPU)
            ├── SessionActivityTracker.js 세션별 도구 호출/파편 활동 추적 (Redis)
            ├── AutoReflect.js            세션 종료 시 자동 reflect 오케스트레이터
            └── memory-schema.sql         PostgreSQL 스키마 정의
```

나머지 모듈들은 이 핵심을 지원한다.

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
├── utils.js           Origin 검증, JSON 바디 파싱, SSE 출력
└── path-validator.js  경로 검증
```

도구 구현은 `lib/tools/`에 분리되어 있다.

```
lib/tools/
├── memory.js    11개 MCP 도구 정의(스키마) 및 핸들러
├── db.js        PostgreSQL 연결 풀, RLS 적용 쿼리 헬퍼 (MCP 미노출)
├── embedding.js OpenAI 텍스트 임베딩 생성
├── stats.js     접근 통계 수집 및 저장
└── index.js     도구 핸들러 export
```

`config/memory.js`는 별도 파일로 분리된 기억 시스템 설정이다. 랭킹 가중치와 stale 임계값을 담는다.

---

## 데이터베이스 스키마: 파편들이 잠드는 공간

스키마명은 `agent_memory`다. 다섯 개의 테이블이 기억의 구조를 형성한다. 스키마 파일은 `lib/memory/memory-schema.sql`이다.

### fragments

모든 기억의 원자 단위. 이 테이블 하나가 시스템의 심장이다.

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
| embedding | vector(1536) | | OpenAI text-embedding-3-small 벡터 |
| is_anchor | BOOLEAN | DEFAULT FALSE | true 시 감쇠, TTL 강등, 만료 삭제 전부 면제 |

인덱스 목록: content_hash(UNIQUE), topic(B-tree), type(B-tree), keywords(GIN), importance DESC(B-tree), created_at DESC(B-tree), agent_id(B-tree), linked_to(GIN), (ttl_tier, created_at)(B-tree), source(B-tree), verified_at(B-tree), is_anchor WHERE TRUE(부분 인덱스).

HNSW 벡터 인덱스는 `embedding IS NOT NULL` 조건부 인덱스로 생성된다. 파라미터: m=16, ef_construction=64, 거리 함수는 vector_cosine_ops. Hierarchical Navigable Small World는 2016년 유리 말코프(Yuri Malkov)가 제안한 근사 최근접 이웃 탐색 알고리즘이다 — 여기서 이 알고리즘의 수학적 상세를 설명하는 것은 이 문서의 범위를 벗어나지만, m=16이 이웃 연결 수를, ef_construction=64가 인덱스 구축 시 탐색 깊이를 의미한다는 점은 운영자가 알아둘 만하다.

### fragment_links

파편 간 관계망을 전담하는 별도 테이블. fragments 테이블의 linked_to 배열과 병행하여 존재한다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGSERIAL PK | 자동 증가 식별자 |
| from_id | TEXT | 출발 파편 (ON DELETE CASCADE) |
| to_id | TEXT | 도착 파편 (ON DELETE CASCADE) |
| relation_type | TEXT | related / caused_by / resolved_by / part_of / contradicts / superseded_by |
| created_at | TIMESTAMPTZ | 관계 생성 시각 |

(from_id, to_id) 조합에 UNIQUE 제약이 걸려 있다. 중복 링크는 저장되지 않는다.

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

---

## 3계층 검색: 세 개의 관문

recall 도구가 호출되면 파편들은 세 개의 관문을 통해 소환된다. 관문들은 순서가 있으며, 앞 관문에서 충분한 결과가 나오면 뒤 관문을 건너뛸 수 있다. 이것은 비용의 문제다 — 벡터 유사도 계산은 Set 교집합보다 비싸다.

![검색 흐름](assets/images/retrieval.png)

**L1: Redis Set 교집합.** 파편이 저장될 때마다 FragmentIndex가 각 키워드를 Redis Set의 키로 사용하여 파편 ID를 저장한다. `keywords:database`라는 Set에는 database를 키워드로 가진 모든 파편의 ID가 들어 있다. 다중 키워드 검색은 여러 Set의 SINTER 연산이다. 교집합 연산의 시간 복잡도는 O(N·K), N은 가장 작은 Set의 크기, K는 키워드 수다. Redis가 인메모리로 처리하므로 수 밀리초 안에 완료된다. L1 결과가 충분하면 L2와 L3로 진행하지 않는다.

**L2: PostgreSQL GIN 인덱스.** L1 결과가 미흡하면 PostgreSQL로 폴백한다. keywords TEXT[] 컬럼에 GIN(Generalized Inverted Index) 인덱스가 걸려 있다. 검색은 `keywords && ARRAY[...]` 연산자로 수행한다 — 배열 간 교집합 존재 여부를 묻는 연산자다. GIN 인덱스는 배열의 각 원소를 개별적으로 인덱싱하므로 이 연산이 인덱스 스캔으로 처리된다. 순차 스캔이 아니다.

**L3: pgvector HNSW 코사인 유사도.** recall 파라미터에 `text` 필드가 있거나 L1/L2 결과가 여전히 미흡할 때 발동한다. 쿼리 텍스트를 OpenAI text-embedding-3-small 모델로 변환하여 1536차원 벡터를 얻고, `embedding <=> $1` 연산자로 코사인 거리를 계산한다. HNSW 인덱스가 근사 최근접 이웃을 빠르게 찾는다. `threshold` 파라미터로 유사도 하한을 지정할 수 있다 — 이 값 미만의 L3 결과는 결과에서 제외된다. L1/L2 경유 결과는 similarity 값이 없으므로 threshold 필터링에서 제외된다.

Redis와 OpenAI API는 선택 사항이다. 없으면 해당 계층 없이 작동한다. PostgreSQL만으로도 L2 검색과 기본 기능은 완전히 동작한다.

세 계층의 결과는 복합 랭킹으로 병합된다. fragments 수가 `MEMORY_CONFIG.ranking.activationThreshold`(기본 100) 이상일 때 복합 랭킹이 활성화된다 — 중요도 가중치 0.6, 최신성 가중치 0.4. 100개 미만일 때는 단순 정렬로 처리한다. 최종 반환량은 `tokenBudget` 파라미터로 제어된다. js-tiktoken cl100k_base 인코더로 파편마다 토큰을 정확히 계산하여 예산 초과 시 잘라낸다. 기본 토큰 예산은 1000이다.

recall에 `includeLinks: true`(기본값)가 설정되어 있으면 결과 파편들의 연결 파편을 1-hop 추가 조회한다. `linkRelationType` 파라미터로 특정 관계 유형만 포함할 수 있다 — 미지정 시 caused_by, resolved_by, related가 포함된다. 연결 파편 조회 한도는 `MEMORY_CONFIG.linkedFragmentLimit`(기본 10)이다.

---

## TTL 계층: 기억에도 온도가 있다

파편은 사용 빈도에 따라 hot, warm, cold, permanent 네 개의 티어를 이동한다. 이 이동은 자동이다. MemoryConsolidator가 주기적으로 판단한다. 다시 참조되는 순간 hot으로 복귀한다. 인간의 장기기억도 이렇게 작동한다 — 오래 안 쓰면 잊히지만, 한번 떠올리면 다시 선명해진다.

![파편 생명주기](assets/images/lifecycle.png)

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

## MCP 도구: 기억을 다루는 11개의 손

모두 `lib/tools/memory.js`에 정의되어 있다. `lib/tool-registry.js`를 통해 등록된다. db_query, db_tables, db_schema 같은 데이터베이스 직접 접근 도구는 내부 유틸리티로만 사용되며 MCP 클라이언트에 노출되지 않는다.

---

### remember

지식을 파편으로 저장한다. 1~3문장의 원자적 단위가 이상적이다. 내용이 이미 존재한다면(content_hash 기준) 중복 저장을 거부한다. FragmentFactory가 저장 전 PII를 마스킹한다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| content | string | Y | 기억할 내용. 300자 이내 권장 |
| topic | string | Y | 주제 레이블 (예: database, deployment, error-handling) |
| type | string | Y | fact / decision / error / preference / procedure / relation |
| keywords | string[] | | 검색 키워드. 미입력 시 content에서 자동 추출 |
| importance | number | | 중요도 0.0~1.0. 미입력 시 type별 기본값 적용 |
| source | string | | 출처 식별자 (세션 ID, 도구명, 파일 경로 등) |
| linkedTo | string[] | | 저장 시점에 즉시 연결할 기존 파편 ID 목록 |
| scope | string | | permanent(기본) / session |
| isAnchor | boolean | | true 시 감쇠 및 만료 삭제 면제 |
| agentId | string | | 에이전트 ID. RLS 격리 컨텍스트 설정에 사용 |

반환값: `{ success: true, id: "...", created: true/false }`. created가 false면 기존 파편이 반환된 것이다(중복).

저장 후 pgvector cosine similarity를 직접 쿼리하여 같은 topic의 유사 파편(similarity > 0.7)과 자동으로 링크를 생성한다. 링크 유형은 규칙 기반으로 결정된다: 같은 유형 + 높은 유사도(> 0.85)이면 `superseded_by`, error 유형 간 해결 관계이면 `resolved_by`, 그 외에는 `related`. 최대 3개까지 자동 생성되며, 임베딩이 없는 파편은 자동 링크를 건너뛴다.

---

### recall

저장된 파편을 검색한다. 키워드, 주제, 유형, 자연어 쿼리를 단독 또는 조합하여 사용할 수 있다.

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| keywords | string[] | L1 Redis Set 교집합 검색에 사용될 키워드 |
| topic | string | 특정 주제로 결과 범위 제한 |
| type | string | 특정 유형으로 결과 범위 제한 |
| text | string | 자연어 쿼리. L3 벡터 검색을 강제 발동한다 |
| tokenBudget | number | 최대 반환 토큰 수. 기본 1000. cl100k_base 기준 |
| includeLinks | boolean | 연결 파편 1-hop 포함 여부. 기본 true |
| linkRelationType | string | caused_by / resolved_by / related / part_of / contradicts |
| threshold | number | L3 코사인 유사도 하한 (0.0~1.0). 이 값 미만의 벡터 검색 결과 제외 |
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

수동 호출 외에, 세션 종료/만료/서버 셧다운 시 AutoReflect가 자동으로 실행된다. Gemini CLI가 가용하면 SessionActivityTracker의 활동 로그를 기반으로 구조화된 요약을 생성하고, CLI가 불가하면 메타데이터(소요시간, 도구 사용 통계, 파편 수) 기반의 최소 fact 파편을 생성한다. AI가 수동으로 reflect를 호출한 세션은 자동 reflect를 건너뛴다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| summary | string | Y | 세션 전체 요약 텍스트 |
| sessionId | string | | 세션 ID |
| decisions | string[] | | 이 세션에서 확정된 기술/아키텍처 결정 목록 |
| errors_resolved | string[] | | 해결한 에러 목록. "에러 설명 + 해결 방법" 형식 권장 |
| new_procedures | string[] | | 이 세션에서 확립된 새 절차/워크플로우 목록 |
| open_questions | string[] | | 미해결 질문 또는 후속 작업 목록 |
| agentId | string | | 에이전트 ID |
| task_effectiveness | object | | 세션 도구 사용 효과성 종합. `{ overall_success: boolean, tool_highlights: string[], tool_pain_points: string[] }` |

---

### context

세션 시작 시 기억 시스템에서 맥락을 복원한다. Core Memory(중요도 높은 고정 파편)와 Working Memory(현재 세션의 파편)를 분리 로드한다. sessionId를 전달하면 해당 세션의 워킹 메모리도 함께 반환된다. 미반영(unreflected) 세션이 존재하면 injectionText에 `[SYSTEM HINT]`로 세션 수를 알려준다.

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

---

### memory_consolidate

10단계 유지보수 파이프라인을 수동으로 실행한다. 파라미터 없음.

---

### graph_explore

에러 파편을 기점으로 인과 관계 체인을 추적한다. RCA(Root Cause Analysis) 전용 도구. caused_by, resolved_by 관계를 1-hop 추적하여 에러의 원인과 해결 절차를 연결된 그래프로 반환한다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| startId | string | Y | 시작 파편 ID. error 타입 파편 권장 |
| agentId | string | | 에이전트 ID |

---

## 권장 사용 흐름

기억 시스템은 세션의 생명주기를 따라 작동한다.

1. 세션 시작 — `context()`로 핵심 기억을 로드한다. 이전 세션에서 축적된 선호, 에러 패턴, 절차가 복원된다. 미반영 세션이 있으면 힌트가 표시된다.
2. 작업 중 — 중요한 결정, 에러, 절차가 발생하면 `remember()`로 저장한다. 저장 시 유사 파편과 자동으로 링크가 생성된다. 과거 경험이 필요하면 `recall()`로 검색한다. 에러를 해결했으면 `forget()`으로 에러 파편을 정리하고 `remember()`로 해결 절차를 기록한다.
3. 세션 종료 — `reflect()`로 세션 내용을 구조화된 파편으로 영속화한다. 수동 호출을 잊더라도 세션 종료/만료 시 AutoReflect가 자동으로 실행된다. 다음 세션의 `context()`가 이 파편들을 불러온다.

이 순환이 반복될수록 AI는 당신의 프로젝트를, 당신의 선호를, 당신이 겪었던 실패를 기억하게 된다.

---

## MemoryEvaluator: 잠들지 않는 검열관

서버가 시작되면 MemoryEvaluator 워커가 백그라운드에서 구동된다. `getMemoryEvaluator().start()`로 시작되는 싱글턴이다. SIGTERM/SIGINT 수신 시 graceful shutdown 흐름에서 중지된다.

워커는 5초 간격으로 Redis 큐 `memory_evaluation`을 폴링한다. 큐가 비어 있으면 대기한다. 큐에서 잡(job)을 꺼내면 Gemini CLI(`geminiCLIJson`)를 호출하여 파편 내용의 합리성을 평가한다. 평가 결과는 fragments 테이블의 utility_score와 verified_at을 갱신하는 데 사용된다.

새 파편이 remember로 저장될 때 평가 큐에 자동으로 투입된다. 평가는 저장과 비동기로 분리되어 있으므로 remember 호출의 응답 시간에 영향을 주지 않는다.

Gemini CLI가 설치되지 않은 환경에서는 워커가 구동되지만 평가 작업을 건너뛴다.

---

## MemoryConsolidator: 기억의 정원사

memory_consolidate 도구가 실행되거나 서버 내부 스케줄러가 트리거할 때 동작하는 11단계 유지보수 파이프라인이다.

1. **TTL 계층 전환**: hot → warm → cold 강등. 접근 빈도와 경과 시간 기준
2. **중요도 감쇠(decay)**: 접근 빈도가 낮은 파편의 importance 하향 조정. `is_anchor=true` 제외
3. **만료 파편 삭제**: stale 임계값을 초과한 cold 파편 삭제. `is_anchor=true` 제외
4. **중복 병합**: content_hash가 동일한 파편들을 가장 중요한 것으로 병합. 링크와 접근 통계 통합
5. **누락 임베딩 보충**: embedding이 NULL인 파편에 대해 비동기 임베딩 생성
6. **utility_score 재계산**: `importance * (1 + ln(max(access_count, 1)))` 공식으로 갱신
7. **앵커 자동 승격**: access_count >= 10 + importance >= 0.8인 파편을 `is_anchor=true`로 승격
8. **증분 모순 탐지 (3단계 하이브리드)**: 마지막 검사 이후 신규 파편에 대해 같은 topic의 기존 파편과 pgvector cosine similarity > 0.85인 쌍을 추출(Stage 1). NLI 분류기(mDeBERTa ONNX)로 entailment/contradiction/neutral을 판정(Stage 2) — 높은 신뢰도 모순(conf >= 0.8)은 Gemini 호출 없이 즉시 해소, 확실한 entailment는 즉시 통과. NLI가 불확실한 케이스(수치/도메인 모순)만 Gemini CLI로 에스컬레이션(Stage 3). 확인 시 `contradicts` 링크 + 시간 논리 기반 해소(구 파편 중요도 하향 + `superseded_by` 링크). CLI 불가 시 similarity > 0.92인 쌍을 Redis pending 큐에 적재
9. **보류 모순 후처리**: Gemini CLI가 가용해지면 pending 큐에서 최대 10건을 꺼내 재판정
10. **피드백 리포트 생성**: tool_feedback/task_feedback 데이터를 집계하여 도구별 유용성 리포트 생성
11. **Redis 인덱스 정리 + stale 파편 수집**: 고아 키워드 인덱스 제거 및 검증 주기 초과 파편 목록 반환

---

## MEMORY_CONFIG: 기억 시스템의 조율판

`config/memory.js`에 정의된 외부 설정 파일이다. 서버 코드를 수정하지 않고 이 파일만 편집하여 랭킹 가중치와 stale 임계값을 조정할 수 있다.

```js
export const MEMORY_CONFIG = {
  ranking: {
    importanceWeight   : 0.6,   // 복합 랭킹에서 중요도의 가중치
    recencyWeight      : 0.4,   // 복합 랭킹에서 최신성의 가중치
    activationThreshold: 100    // 이 수 이상의 파편이 있을 때 복합 랭킹 활성화
  },
  staleThresholds: {
    procedure: 30,   // 절차 파편의 stale 기준 (일)
    fact      : 60,  // 사실 파편의 stale 기준 (일)
    decision  : 90,  // 결정 파편의 stale 기준 (일)
    default   : 60   // 나머지 유형의 stale 기준 (일)
  },
  linkedFragmentLimit: 10  // recall의 includeLinks 시 1-hop 연결 파편 최대 수
};
```

importanceWeight와 recencyWeight의 합은 1.0이어야 한다.

---

## 환경 변수

### 서버

| 변수 | 기본값 | 설명 |
|------|--------|------|
| PORT | 56332 | HTTP 리슨 포트 |
| MEMENTO_ACCESS_KEY | (없음) | Bearer 인증 키. 미설정 시 인증 비활성화 |
| SESSION_TTL_MINUTES | 60 | 세션 유효 시간 (분) |
| LOG_DIR | /var/log/mcp | Winston 로그 파일 저장 디렉토리 |
| ALLOWED_ORIGINS | (없음) | 허용할 Origin 목록. 쉼표로 구분. 미설정 시 전체 허용 |

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
| OPENAI_API_KEY | (없음) | OpenAI API 키. 임베딩 생성에 사용 |
| EMBEDDING_MODEL | text-embedding-3-small | 사용할 임베딩 모델 |
| EMBEDDING_DIMENSIONS | 1536 | 임베딩 벡터 차원 수. DB 스키마의 vector(1536)와 일치해야 한다 |
| GEMINI_API_KEY | (없음) | Google Gemini API 키. 레거시 호환용. Gemini CLI 설치 시 불필요 |

---

## HTTP 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | /mcp | Streamable HTTP. JSON-RPC 요청 수신. MCP-Session-Id 헤더 필요 (초기 initialize 제외) |
| GET | /mcp | Streamable HTTP. SSE 스트림 열기. 서버 측 푸시용 |
| DELETE | /mcp | Streamable HTTP. 세션 명시적 종료 |
| GET | /sse | Legacy SSE. 세션 생성. `accessKey` 쿼리 파라미터로 인증 |
| POST | /message?sessionId= | Legacy SSE. JSON-RPC 요청 수신. 응답은 SSE 스트림으로 전달 |
| GET | /health | 헬스 체크. Redis 연결, DB 쿼리(SELECT 1), 세션 상태를 확인하고 JSON으로 반환 |
| GET | /metrics | Prometheus 메트릭. prom-client가 수집한 HTTP 요청 카운터, 세션 게이지 등 |
| GET | /.well-known/oauth-authorization-server | OAuth 2.0 인가 서버 메타데이터 |
| GET | /.well-known/oauth-protected-resource | OAuth 2.0 보호 리소스 메타데이터 |
| GET | /authorize | OAuth 2.0 인가 엔드포인트. PKCE code_challenge 필요 |
| POST | /token | OAuth 2.0 토큰 엔드포인트. authorization_code 교환 |

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

## 설치

```bash
# 의존성 설치
npm install

# (선택) CUDA 11 환경에서 설치 오류 발생 시 CPU 전용으로 설치
# npm install --onnxruntime-node-install-cuda=skip

# PostgreSQL 스키마 적용
psql -U $POSTGRES_USER -d $POSTGRES_DB -f lib/memory/memory-schema.sql

# 서버 실행
node server.js
```

### 주의사항: ONNX Runtime 및 CUDA
CUDA 11이 설치된 시스템에서 `@huggingface/transformers`의 의존성인 `onnxruntime-node`가 GPU 바인딩을 시도하다 설치에 실패할 수 있습니다. 이 프로젝트는 CPU 전용으로 최적화되어 있으므로, 설치 시 `--onnxruntime-node-install-cuda=skip` 플래그를 사용하면 문제 없이 설치됩니다.

Claude Code 연결 설정 예시 (`~/.claude/settings.json` 또는 프로젝트 `.claude/settings.json`):

```json
{
  "mcpServers": {
    "memento": {
      "type": "http",
      "url": "http://localhost:56332/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MEMENTO_ACCESS_KEY"
      }
    }
  }
}
```

외부에서 접속할 때는 nginx 리버스 프록시를 통해 노출한다. 내부 IP나 내부 포트를 외부 문서에 직접 기재하지 않는다.

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
