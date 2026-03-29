# Configuration

---

## Environment Variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 57332 | HTTP listen port |
| MEMENTO_ACCESS_KEY | (none) | Bearer authentication key. Authentication disabled when unset |
| SESSION_TTL_MINUTES | 60 | Session TTL (minutes) |
| LOG_DIR | /var/log/mcp | Winston log file directory |
| ALLOWED_ORIGINS | (none) | Allowed Origins list. Comma-separated. All origins allowed when unset |
| RATE_LIMIT_WINDOW_MS | 60000 | Rate limiting window size (ms) |
| RATE_LIMIT_MAX_REQUESTS | 120 | Max requests per IP per window |
| CONSOLIDATE_INTERVAL_MS | 21600000 | Auto-maintenance (consolidate) interval (ms). Default 6 hours |
| EVALUATOR_MAX_QUEUE | 100 | MemoryEvaluator queue size cap (older jobs dropped on overflow) |
| OAUTH_ALLOWED_REDIRECT_URIS | (none) | OAuth redirect_uri allowed prefixes (comma-separated, only localhost allowed when unset) |

### PostgreSQL

POSTGRES_* prefixes take precedence over DB_* prefixes. Both formats can be mixed.

| Variable | Description |
|----------|-------------|
| POSTGRES_HOST / DB_HOST | Host address |
| POSTGRES_PORT / DB_PORT | Port number. Default 5432 |
| POSTGRES_DB / DB_NAME | Database name |
| POSTGRES_USER / DB_USER | Connection user |
| POSTGRES_PASSWORD / DB_PASSWORD | Connection password |
| DB_MAX_CONNECTIONS | Connection pool max connections. Default 20 |
| DB_IDLE_TIMEOUT_MS | Idle connection return timeout ms. Default 30000 |
| DB_CONN_TIMEOUT_MS | Connection acquisition timeout ms. Default 10000 |
| DB_QUERY_TIMEOUT | Query timeout ms. Default 30000 |

### Redis

| Variable | Default | Description |
|----------|---------|-------------|
| REDIS_ENABLED | false | Enable Redis. When false, L1 search and caching are disabled |
| REDIS_SENTINEL_ENABLED | false | Use Sentinel mode |
| REDIS_HOST | localhost | Redis server host |
| REDIS_PORT | 6379 | Redis server port |
| REDIS_PASSWORD | (none) | Redis authentication password |
| REDIS_DB | 0 | Redis database number |
| REDIS_MASTER_NAME | mymaster | Sentinel master name |
| REDIS_SENTINELS | localhost:26379, localhost:26380, localhost:26381 | Sentinel node list. Comma-separated host:port format |

### Caching

| Variable | Default | Description |
|----------|---------|-------------|
| CACHE_ENABLED | Same as REDIS_ENABLED | Enable query result caching |
| CACHE_DB_TTL | 300 | DB query result cache TTL (seconds) |
| CACHE_SESSION_TTL | SESSION_TTL_MS / 1000 | Session cache TTL (seconds) |

### AI

| Variable | Default | Description |
|----------|---------|-------------|
| OPENAI_API_KEY | (none) | OpenAI API key. Used when `EMBEDDING_PROVIDER=openai` |
| EMBEDDING_PROVIDER | openai | Embedding provider. `openai` \| `gemini` \| `ollama` \| `localai` \| `custom` |
| EMBEDDING_API_KEY | (none) | Generic embedding API key. Falls back to `OPENAI_API_KEY` when unset |
| EMBEDDING_BASE_URL | (none) | OpenAI-compatible endpoint URL when `EMBEDDING_PROVIDER=custom` |
| EMBEDDING_MODEL | (provider default) | Embedding model to use. Provider-specific default applied when omitted |
| EMBEDDING_DIMENSIONS | (provider default) | Embedding vector dimensions. Must match the DB schema's vector dimension |
| EMBEDDING_SUPPORTS_DIMS_PARAM | (provider default) | Override dimensions parameter support (`true`\|`false`) |
| GEMINI_API_KEY | (none) | Google Gemini API key. Used when `EMBEDDING_PROVIDER=gemini` |

---

## MEMORY_CONFIG

Configuration file defined in `config/memory.js`. Ranking weights and stale thresholds can be adjusted without modifying server code.

```js
export const MEMORY_CONFIG = {
  ranking: {
    importanceWeight    : 0.4,   // Importance weight in time-semantic composite ranking
    recencyWeight       : 0.3,   // Temporal proximity weight (exponential decay from anchorTime)
    semanticWeight      : 0.3,   // Semantic similarity weight
    activationThreshold : 0,     // Always apply composite ranking
    recencyHalfLifeDays : 30,    // Temporal proximity half-life (days)
  },
  staleThresholds: {
    procedure: 30,   // Stale threshold for procedure fragments (days)
    fact      : 60,  // Stale threshold for fact fragments (days)
    decision  : 90,  // Stale threshold for decision fragments (days)
    default   : 60   // Stale threshold for other types (days)
  },
  halfLifeDays: {
    procedure : 30,  // Decay half-life -- time for importance to halve (days)
    fact      : 60,
    decision  : 90,
    error     : 45,
    preference: 120,
    relation  : 90,
    default   : 60
  },
  rrfSearch: {
    k             : 60,   // RRF denominator constant. Larger values reduce top-rank dependency
    l1WeightFactor: 2.0   // Weight multiplier for L1 Redis results (highest priority injection)
  },
  linkedFragmentLimit: 10,  // Max 1-hop linked fragments on recall with includeLinks
  embeddingWorker: {
    batchSize      : 10,      // Fragments per batch
    intervalMs     : 5000,    // Polling interval (ms)
    retryLimit     : 3,       // Retry count on failure
    retryDelayMs   : 2000,    // Retry interval (ms)
    queueKey       : "memento:embedding_queue"
  },
  contextInjection: {
    maxCoreFragments   : 15,     // Core Memory max fragment count
    maxWmFragments     : 10,     // Working Memory max fragment count
    typeSlots          : {       // Per-type max slots
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
    utilityThreshold       : 0.15,   // Below this + inactive = deletion candidate
    gracePeriodDays        : 7,      // Minimum survival period (days)
    inactiveDays           : 60,     // Inactivity period (days)
    maxDeletePerCycle      : 50,     // Max deletions per cycle
    factDecisionPolicy     : {
      importanceThreshold  : 0.2,    // GC importance threshold for fact/decision
      orphanAgeDays        : 30      // Orphan fact/decision deletion threshold (days)
    },
    errorResolvedPolicy    : {
      maxAgeDays           : 30,     // [resolved] error fragment deletion threshold (days)
      maxImportance        : 0.3     // Below this = deletion candidate
    }
  },
  reflectionPolicy: {
    maxAgeDays       : 30,       // session_reflect fragment deletion threshold (days)
    maxImportance    : 0.3,      // Below this = deletion candidate
    keepPerType      : 5,        // Keep latest N per type
    maxDeletePerCycle: 30        // Max deletions per cycle
  },
  semanticSearch: {
    minSimilarity: 0.2,          // L3 pgvector search minimum similarity (default 0.2)
    limit        : 10            // L3 max return count
  },
  temperatureBoost: {
    warmWindowDays     : 7,      // Apply warmBoost to fragments accessed within this window
    warmBoost          : 0.2,    // Score boost for recently accessed fragments
    highAccessBoost    : 0.15,   // Score boost for fragments exceeding access threshold
    highAccessThreshold: 5,      // Access count threshold for highAccessBoost
    learningBoost      : 0.3     // Score boost for learning_extraction fragments
  }
};
```

The sum of importanceWeight + recencyWeight + semanticWeight must equal 1.0. halfLifeDays determines decay speed and operates independently of staleThresholds. rrfSearch.k is the RRF denominator stabilization constant, with 60 as the general-purpose default. gc.factDecisionPolicy cleans up orphan fact/decision fragments under separate criteria to reduce search noise.

---

## Switching Embedding Providers

Switch providers with a single `EMBEDDING_PROVIDER` environment variable. Model, dimensions, and base URL are automatically determined from provider defaults, with individual environment variable overrides available as needed.

Embeddings are used for L3 semantic search and automatic link creation.

> Dimension change warning: Changing `EMBEDDING_DIMENSIONS` requires a PostgreSQL schema change. Run `node scripts/migration-007-flexible-embedding-dims.js` followed by `node scripts/backfill-embeddings.js` in order.

---

### OpenAI (default)

```env
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

| Model | Dimensions | Notes |
|-------|-----------|-------|
| text-embedding-3-small | 1536 | Default. Cost-efficient |
| text-embedding-3-large | 3072 | High precision. 2x cost |
| text-embedding-ada-002 | 1536 | Legacy compatible |

---

### Google Gemini

`text-embedding-004` was discontinued January 14, 2026. The currently recommended model is `gemini-embedding-001` (3072 dimensions).

```env
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=AIza...
```

3072 dimensions differs from the default schema (1536), so migration-007 must be run on first switch:

```bash
EMBEDDING_DIMENSIONS=3072 DATABASE_URL=$DATABASE_URL \
  node scripts/migration-007-flexible-embedding-dims.js
DATABASE_URL=$DATABASE_URL node scripts/backfill-embeddings.js
```

> halfvec type requires pgvector 0.7.0 or later. Check version: `SELECT extversion FROM pg_extension WHERE extname = 'vector';`

| Model | Dimensions | Notes |
|-------|-----------|-------|
| gemini-embedding-001 | 3072 | Current recommended model. High precision |
| text-embedding-004 | 768 | Discontinued 2026-01-14 |

---

### Ollama (local)

Ollama must be running at `http://localhost:11434`.

```env
EMBEDDING_PROVIDER=ollama
# EMBEDDING_MODEL=nomic-embed-text  # default
```

```bash
# Download models
ollama pull nomic-embed-text
ollama pull mxbai-embed-large
```

| Model | Dimensions | Notes |
|-------|-----------|-------|
| nomic-embed-text | 768 | 8192 token context, high MTEB performance |
| mxbai-embed-large | 1024 | 512 context, competitive MTEB scores |
| all-minilm | 384 | Ultra-lightweight, suitable for local testing |

---

### LocalAI (local)

```env
EMBEDDING_PROVIDER=localai
```

---

### Custom OpenAI-Compatible Server

Use for any OpenAI-compatible server such as LM Studio or llama.cpp.

```env
EMBEDDING_PROVIDER=custom
EMBEDDING_BASE_URL=http://my-server:8080/v1
EMBEDDING_API_KEY=my-key
EMBEDDING_MODEL=my-model
EMBEDDING_DIMENSIONS=1024
```

---

### Commercial APIs (Custom Adapter Required)

Cohere, Voyage AI, Mistral, Jina AI, and Nomic are either incompatible with the OpenAI SDK or have separate API structures. Replace the `generateEmbedding` function in `lib/tools/embedding.js` with the examples below.

#### Cohere

```bash
npm install cohere-ai
```

```js
// lib/tools/embedding.js -- replace generateEmbedding
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

| Model | Dimensions | Notes |
|-------|-----------|-------|
| embed-v4.0 | 1536 | Latest, multilingual |
| embed-multilingual-v3.0 | 1024 | Legacy multilingual |

---

#### Voyage AI

```js
// lib/tools/embedding.js -- replace generateEmbedding
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

| Model | Dimensions | Notes |
|-------|-----------|-------|
| voyage-3.5 | 1024 | Highest accuracy |
| voyage-3.5-lite | 512 | Low cost, fast |
| voyage-code-3 | 1024 | Code-specialized |

---

#### Mistral AI

OpenAI SDK compatible, so just swap the `baseURL`.

```js
// lib/tools/embedding.js -- replace generateEmbedding
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

Free tier: 100 RPM / 1M tokens/month.

```js
// lib/tools/embedding.js -- replace generateEmbedding
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

| Model | Dimensions | Notes |
|-------|-----------|-------|
| jina-embeddings-v3 | 1024 | MRL support (32~1024 flexible dimensions) |
| jina-embeddings-v2-base-en | 768 | English-specialized |

---

#### Nomic

Free tier: 1M tokens/month. OpenAI SDK compatible, so applicable via `baseURL` change.

```js
// lib/tools/embedding.js -- replace generateEmbedding
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

### Provider Comparison

| Service | Dimensions | Configuration | Free Tier |
|---------|-----------|---------------|-----------|
| OpenAI text-embedding-3-small | 1536 | `EMBEDDING_PROVIDER=openai` | None |
| OpenAI text-embedding-3-large | 3072 | `EMBEDDING_PROVIDER=openai` | None |
| Google Gemini gemini-embedding-001 | 3072 | `EMBEDDING_PROVIDER=gemini` | Yes (limited) |
| Ollama (nomic-embed-text) | 768 | `EMBEDDING_PROVIDER=ollama` | Fully free (local) |
| Ollama (mxbai-embed-large) | 1024 | `EMBEDDING_PROVIDER=ollama` | Fully free (local) |
| LocalAI | Variable | `EMBEDDING_PROVIDER=localai` | Fully free (local) |
| Custom compatible server | Variable | `EMBEDDING_PROVIDER=custom` | -- |
| Cohere embed-v4.0 | 1536 | Code replacement | None |
| Voyage AI voyage-3.5 | 1024 | Code replacement | None |
| Mistral mistral-embed | 1024 | Code replacement | None |
| Jina jina-embeddings-v3 | 1024 | Code replacement | Yes (1M/month) |
| Nomic nomic-embed-text-v1.5 | 768 | Code replacement | Yes (1M/month) |

---

## Tests

### Full test suite (no DB required)
```bash
npm test          # Jest (tests/*.test.js) + node:test (tests/unit/*.test.js) sequential. tests/unit/ is node:test exclusive and excluded from Jest.
```

Individual runs:
```bash
npm run test:jest        # Jest -- tests/*.test.js
npm run test:unit:node   # node:test -- tests/unit/*.test.js
npm run test:integration # node:test -- tests/integration/*.test.js + tests/e2e/*.test.js
```

### E2E tests (PostgreSQL required)

Local Docker environment (recommended):
```bash
npm run test:e2e:local   # Starts test DB via docker-compose then runs
```

Using an existing DB connection:
```bash
DATABASE_URL=postgresql://user:pass@host:port/db npm run test:e2e
```

### Full CI (DB required)
```bash
npm run test:ci          # npm test + test:e2e
```
