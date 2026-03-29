# Configuration

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
| CONSOLIDATE_INTERVAL_MS | 3600000 | 자동 유지보수(consolidate) 실행 간격 (ms). 기본 1시간 |
| EVALUATOR_MAX_QUEUE | 100 | MemoryEvaluator 큐 크기 상한 (초과 시 오래된 작업 드롭) |
| OAUTH_ALLOWED_REDIRECT_URIS | (없음) | OAuth redirect_uri 허용 prefix (쉼표 구분, 미설정 시 localhost만 허용) |
| DEDUP_BATCH_SIZE | 100 | 시맨틱 중복 제거 배치 크기 |
| DEDUP_MIN_FRAGMENTS | 5 | dedup 최소 파편 수. 이 수 미만이면 중복 제거를 건너뛴다 |
| COMPRESS_AGE_DAYS | 30 | 기억 압축 대상 비활성 일수 |
| COMPRESS_MIN_GROUP | 3 | 압축 그룹 최소 크기. 이 수 미만이면 압축하지 않는다 |
| RERANKER_ENABLED | false | cross-encoder reranking 활성화. true 시 recall 결과를 cross-encoder로 재순위화 |

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
  },
  temperatureBoost: {
    warmWindowDays     : 7,      // 이 기간 내 접근 파편에 warmBoost 적용
    warmBoost          : 0.2,    // 최근 접근 파편 점수 가산
    highAccessBoost    : 0.15,   // 접근 횟수 임계 초과 파편 점수 가산
    highAccessThreshold: 5,      // highAccessBoost 적용 기준 접근 횟수
    learningBoost      : 0.3    // learning_extraction 파편 점수 가산
  }
};
```

importanceWeight + recencyWeight + semanticWeight의 합은 1.0이어야 한다. halfLifeDays는 감쇠의 속도를 결정하며 staleThresholds와 독립적으로 동작한다. rrfSearch.k는 RRF 점수의 분모 안정화 상수로, 60이 일반 용도 기본값이다. gc.factDecisionPolicy는 fact/decision 유형의 고립 파편을 별도 기준으로 정리하여 검색 노이즈를 줄인다.

---

## 임베딩 Provider 전환

`EMBEDDING_PROVIDER` 환경변수 하나로 provider를 전환할 수 있다. model, dimensions, base URL은 provider 기본값으로 자동 결정되며, 필요 시 개별 환경변수로 override 가능하다.

임베딩은 L3 시맨틱 검색과 자동 링크 생성에 사용된다.

> 차원 변경 시 주의: `EMBEDDING_DIMENSIONS`를 바꾸면 PostgreSQL 스키마도 변경해야 한다. `node scripts/migration-007-flexible-embedding-dims.js`와 `node scripts/backfill-embeddings.js`를 순서대로 실행할 것.

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
  node scripts/migration-007-flexible-embedding-dims.js
DATABASE_URL=$DATABASE_URL node scripts/backfill-embeddings.js
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

## 테스트

### 전체 테스트 (DB 불필요)
```bash
npm test          # Jest (tests/*.test.js) + node:test (tests/unit/*.test.js) 순차 실행. tests/unit/은 node:test 전용이며 Jest에서 제외된다.
```

개별 실행:
```bash
npm run test:jest        # Jest — tests/*.test.js
npm run test:unit:node   # node:test — tests/unit/*.test.js
npm run test:integration # node:test — tests/integration/*.test.js + tests/e2e/*.test.js
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
