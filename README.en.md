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

Quick entry points:

- [Quick Start](docs/getting-started/quickstart.md)
- [Windows WSL2 Setup](docs/getting-started/windows-wsl2.md)
- [Windows PowerShell Setup](docs/getting-started/windows-powershell.md)
- [Claude Code Configuration](docs/getting-started/claude-code.md)
- [First Memory Flow](docs/getting-started/first-memory-flow.md)
- [Troubleshooting](docs/getting-started/troubleshooting.md)
- [Installation Guide](INSTALL.en.md)

## Quick Start

Minimum setup:

- Required: Node.js 20+, PostgreSQL, `vector` extension
- Optional: Redis
- Optional: embedding provider
- Optional: Claude Code integration

Shortest bootstrap path:

```bash
cp .env.example.minimal .env
# Edit .env values, then load into current shell
export $(grep -v '^#' .env | grep '=' | xargs)
npm install
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql "$DATABASE_URL" -f lib/memory/memory-schema.sql
node server.js
```

After the server starts, validate `remember`, `recall`, and `context` with [First Memory Flow](docs/getting-started/first-memory-flow.md).

## Supported Environments

| Environment | Recommendation | Start Here |
|-------------|----------------|------------|
| Linux / macOS | Recommended | [Quick Start](docs/getting-started/quickstart.md) |
| Windows + WSL2 | Best option | [Windows WSL2 Setup](docs/getting-started/windows-wsl2.md) |
| Windows + PowerShell | Limited support | [Windows PowerShell Setup](docs/getting-started/windows-powershell.md) |

## When Claude Code Is Needed

- If you only want to run the server: Claude Code configuration is not required
- If you want Claude Code to call memory tools directly: use [Claude Code Configuration](docs/getting-started/claude-code.md)

---

## Overview

Memento MCP is a fragment-based persistent memory server implementing the Model Context Protocol (MCP). It gives stateless language model agents durable long-term memory that persists across session boundaries.

Agent knowledge is decomposed into discrete, typed **fragments** — atomic units of 1–3 sentences classified into six categories: `fact`, `decision`, `error`, `preference`, `procedure`, and `relation`. Retrieval uses a three-tier cascade: Redis Set intersection (L1), PostgreSQL GIN-indexed array queries (L2), and pgvector HNSW cosine similarity (L3), with composite ranking over importance and recency. A background worker evaluates fragment quality via Gemini CLI. A consolidation pipeline handles TTL tier transitions, importance decay, deduplication, and contradiction detection (pgvector similarity filtering → NLI classification via mDeBERTa ONNX → Gemini CLI escalation for ambiguous cases). Session termination triggers automatic reflection that converts session activity into structured fragments.

The server exposes 12 MCP tools, supports MCP protocol versions 2024-11-05 through 2025-11-25, implements both Streamable HTTP and Legacy SSE transports, and provides OAuth 2.0 PKCE authentication. Default port: 57332.

---

## Table of Contents

1. Introduction
2. System Architecture
3. Persistence Layer: Schema Design and Indexing
4. Retrieval Architecture: The Three-Tier Cascade
5. Fragment Lifecycle: TTL Model and Scope Semantics
6. MCP Tool Interface
7. Asynchronous Quality Evaluation: MemoryEvaluator
8. Consolidation Pipeline: MemoryConsolidator
9. Fault Tolerance and Degradation Behavior
10. Configuration
11. Deployment
12. Endpoint Reference

---

## 1. Introduction

Language model sessions are stateless: context accumulated during one session is lost when the session closes. Prepending full conversation history to the context window is impractical — it wastes tokens and degrades signal-to-noise ratio as history grows.

Memento MCP addresses this by persisting knowledge as discrete, independently retrievable **fragments** rather than monolithic transcripts. Each fragment is a typed, keyword-annotated, vector-embedded record linked to related fragments via explicit typed edges. A lifecycle management policy governs TTL tier assignment, importance score decay, and eventual expiration.

![Knowledge Graph](assets/images/knowledge-graph.png)

![Token Efficiency](assets/images/token-efficiency.png)

---

## 2. System Architecture

The system decomposes into three structural layers: the HTTP transport layer, the MCP protocol and tool dispatch layer, and the memory subsystem proper.

```
┌────────────────────────────────────────────────────────────────────┐
│                           MCP Client                               │
└───────────────────────────────┬────────────────────────────────────┘
                                │ HTTP (Streamable / Legacy SSE)
┌───────────────────────────────▼────────────────────────────────────┐
│               HTTP Transport Layer  (server.js)                    │
│  POST /mcp   GET /mcp   DELETE /mcp   GET /sse   POST /message     │
│  GET /health   GET /metrics   OAuth 2.0 endpoints                  │
└───────────────────────────────┬────────────────────────────────────┘
                                │ JSON-RPC 2.0 dispatch
┌───────────────────────────────▼────────────────────────────────────┐
│         Protocol & Tool Dispatch  (jsonrpc.js + tool-registry.js)  │
│                       12 MCP Memory Tools                          │
└──────────────┬────────────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────────┐
│                 Memory Subsystem  (lib/memory/)                    │
│                                                                    │
│  MemoryManager  ──►  FragmentFactory  (PII mask, TF keywords,     │
│       │                               TTL inference, hash)        │
│       ├──►  FragmentStore  ◄──────────────────────────────────┐   │
│       │        │  (PostgreSQL CRUD + Redis L1 sync)           │   │
│       └──►  FragmentSearch                                    │   │
│                │  L1: Redis SINTER                            │   │
│                │  L2: PostgreSQL GIN &&                       │   │
│                └─►L3: pgvector HNSW cosine                    │   │
└────────────────────────────┬──────────────────────────────────┘   │
                             │              Background Workers       │
               ┌─────────────┴──────┐   ┌────────────────────────┐  │
               │       Redis        │   │   MemoryEvaluator      │  │
               │  L1 keyword Sets   │   │   (Gemini CLI)         │  │
               │  Working Memory    │   │   5s polling queue     │  │
               │  Evaluation queue  │   ├────────────────────────┤  │
               │  Session Activity  │   │   MemoryConsolidator   ├──┘
               └────────────────────┘   │   18-step pipeline     │
                                        │   NLI + Gemini hybrid  │
               ┌────────────────────┐   ├────────────────────────┤
               │   NLI Classifier   │   │   AutoReflect          │
               │  mDeBERTa ONNX CPU │───│   Session close hook   │
               └────────────────────┘   └────────────────────────┘
               ┌────────────────────────┴────────────────────────┐
               │         PostgreSQL  (agent_memory schema)        │
               │  fragments (pgvector HNSW + GIN + RLS)          │
               │  fragment_links     fragment_versions            │
               │  tool_feedback      task_feedback                │
               └──────────────────────────────────────────────────┘
```

### 2.1 System Architecture Diagram

![System Architecture](assets/images/memento_architecture.svg)

### 2.2 HTTP Transport Layer

`server.js` implements a Node.js HTTP server handling twelve distinct endpoint routes. Two MCP transports are supported concurrently:

- **Streamable HTTP** (MCP specification §2025-03-26 and later): `POST /mcp` receives JSON-RPC 2.0 request bodies; `GET /mcp` establishes a server-sent event stream for server-initiated pushes; `DELETE /mcp` terminates sessions explicitly.
- **Legacy SSE** (MCP specification §2024-11-05): `GET /sse` creates a session and opens the SSE stream; `POST /message?sessionId=<id>` receives JSON-RPC requests whose responses are delivered over the SSE channel.

Operational endpoints: `GET /health` returns structured health status for PostgreSQL query execution (`SELECT 1`), Redis connectivity, and active session counts. When `REDIS_ENABLED=false`, Redis reports `{ status: "disabled" }` without triggering degraded mode. `GET /metrics` serves Prometheus-compatible metrics collected via `prom-client`.

OAuth 2.0 endpoints: `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource`, `GET /authorize`, `POST /token`. PKCE (`code_challenge` / `code_verifier`) is required for the authorization code flow.

### 2.2 Protocol and Dispatch Layer

`lib/jsonrpc.js` parses incoming JSON-RPC 2.0 envelopes and dispatches to registered method handlers. `lib/tool-registry.js` registers the twelve memory tools exported from `lib/tools/memory.js`. Database access utilities (`lib/tools/db.js`), embedding generation (`lib/tools/embedding.js`), and access statistics (`lib/tools/stats.js`) are internal dependencies not exposed through the MCP tool interface.

### 2.3 Memory Subsystem

`lib/memory/` contains all memory-domain logic:

| Module | Responsibility |
|--------|----------------|
| `MemoryManager.js` | Business logic facade. Singleton. Coordinates all memory operations. |
| `FragmentFactory.js` | Fragment construction, schema validation, keyword extraction, PII masking, TTL inference. |
| `FragmentStore.js` | Facade: delegates reads to `FragmentReader.js` and writes to `FragmentWriter.js`; maintains Redis L1 index synchronization interface. |
| `FragmentReader.js` | Read-only PostgreSQL operations (getById, getByIds, searchByKeywords, ownership checks). |
| `FragmentWriter.js` | Write-path PostgreSQL operations (insert, update, delete) with Redis L1 sync. |
| `FragmentSearch.js` | Three-tier retrieval orchestration (structured: L1→L2; semantic: L1→L2‖L3 RRF merge). Per-layer latency instrumentation via `SearchMetrics`. |
| `FragmentIndex.js` | Redis L1 index management (Set operations per keyword). |
| `EmbeddingWorker.js` | Redis queue-based async embedding generation worker (EventEmitter). Emits `embedding_ready` on completion. |
| `GraphLinker.js` | Subscribes to `embedding_ready`; generates typed edges for newly embedded fragments. Retroactive linking during consolidation. Hebbian co-retrieval linking (`buildCoRetrievalLinks`). |
| `MorphemeIndex.js` | Morpheme-level embedding lookup via `morpheme_dict` table. L3 fallback when semantic results are sparse. |
| `MemoryConsolidator.js` | Eighteen-step lifecycle maintenance pipeline (NLI + Gemini CLI hybrid contradiction detection, feedback-adaptive importance calibration). |
| `ConflictResolver.js` | Conflict detection at `remember` time; auto-linking and supersede processing. |
| `SessionLinker.js` | Session fragment integration, automatic linking, cycle detection. |
| `LinkStore.js` | Fragment link management (`fragment_links` CRUD + RCA chain traversal). |
| `FragmentGC.js` | Fragment expiration deletion, exponential decay, TTL tier transitions. |
| `ConsolidatorGC.js` | Feedback reports, stale fragment collection/cleanup, long fragment splitting, feedback-based calibration. |
| `ContradictionDetector.js` | Contradiction detection, supersession detection, pending queue processing. |
| `MemoryEvaluator.js` | Asynchronous Gemini CLI quality assessment worker. Singleton. |
| `NLIClassifier.js` | Natural Language Inference classifier (mDeBERTa ONNX, CPU-only). Entailment/contradiction/neutral labeling for contradiction detection Stage 2. |
| `SessionActivityTracker.js` | Per-session tool call and fragment activity tracking (Redis Hash). TTL 24h. |
| `AutoReflect.js` | Automatic `reflect` orchestrator triggered on session termination. Gemini CLI summary with minimal fallback. |
| `decay.js` | Half-life constants per fragment type, pure exponential decay function, and ACT-R EMA activation approximation (`updateEmaActivation`, `computeEmaRankBoost`). |
| `SearchMetrics.js` | Per-layer latency collector (L1/L2/L3/total). Redis circular buffer (100 samples). Exposes P50/P90/P99. |
| `normalize-vectors.js` | One-time migration script to L2-normalize existing embeddings in the database. |
| `memory-schema.sql` | PostgreSQL DDL for the `agent_memory` schema. |
| `migration-001-temporal.sql` | Schema migration: adds `valid_from`, `valid_to`, `superseded_by` columns and temporal indexes. |
| `migration-002-decay.sql` | Schema migration: adds `last_decay_at` column for idempotent decay tracking. |
| `migration-003-api-keys.sql` | Schema migration: creates `api_keys` and `api_key_usage` tables for API key management. |
| `migration-004-key-isolation.sql` | Schema migration: adds `key_id` column to `fragments` for per-API-key memory isolation. |
| `migration-005-gc-columns.sql` | Schema migration: adds auxiliary indexes on `utility_score` and `access_count` to reinforce GC policy queries. |
| `migration-006-superseded-by-constraint.sql` | Schema migration: extends `fragment_links.relation_type` CHECK to include `superseded_by`. |
| `migration-007-link-weight.sql` | Schema migration: adds `weight` column to `fragment_links` for link strength tracking. |
| `migration-008-morpheme-dict.sql` | Schema migration: creates `morpheme_dict` table for morpheme-level embedding lookup. |
| `migration-009-co-retrieved.sql` | Schema migration: extends `fragment_links.relation_type` CHECK to include `co_retrieved` (Hebbian co-retrieval links). |
| `migration-010-ema-activation.sql` | Schema migration: adds `ema_activation` and `ema_last_updated` columns to `fragments` for ACT-R EMA tracking. |
| `migration-011-key-groups.sql` | Schema migration: creates `api_key_groups` and `api_key_group_members` tables for API key group management. |
| `migration-007-flexible-embedding-dims.js` | Schema migration script: converts the `embedding` column to `halfvec(N)` for models with >2000 dimensions (pgvector ≥0.7.0 required). Run with `EMBEDDING_DIMENSIONS=<N>`. |
| `backfill-embeddings.js` | One-time script to regenerate embeddings for all fragments lacking them; use after a provider or dimension change. |

**Admin module:**

| Module | Responsibility |
|--------|----------------|
| `lib/admin/ApiKeyStore.js` | API key CRUD operations and authentication verification. SHA-256 hash-only storage; raw key returned once at creation. |
| `lib/admin/admin-routes.js` | Admin REST endpoint handlers (stats, activity, keys, groups). Extracted from `server.js` for separation of concerns. |

Supporting infrastructure modules:

| Module | Responsibility |
|--------|----------------|
| `lib/config.js` | Environment variable binding and typed constant export |
| `lib/auth.js` | Bearer token verification |
| `lib/oauth.js` | OAuth 2.0 PKCE authorization and token endpoint logic |
| `lib/sessions.js` | Session lifecycle management for both transport types; async auto-reflect on close |
| `lib/redis.js` | `ioredis` client initialization with optional Sentinel support |
| `lib/gemini.js` | Google Gemini API/CLI client (CLI preferred when available) |
| `lib/compression.js` | Response compression (gzip / deflate) |
| `lib/metrics.js` | Prometheus metric collectors (`prom-client`) |
| `lib/logger.js` | Winston structured logger with daily log rotation |
| `lib/rate-limiter.js` | IP-based sliding window rate limiter |
| `lib/utils.js` | Origin validation, JSON body parsing (2MB limit), SSE framing |
| `lib/http-handlers.js` | HTTP request handlers for MCP and operational endpoints (health, metrics, OAuth, SSE); excludes Admin routes |
| `lib/scheduler.js` | Periodic task scheduler (manages all setInterval jobs after server start) |
| `lib/tools/memory-schemas.js` | Tool schema definitions (`inputSchema` for all 12 memory tools) |
| `lib/tools/db-tools.js` | MCP DB tool handlers (separated from `lib/tools/db.js`) |
| `lib/http/helpers.js` | HTTP SSE/request helpers |
| `lib/logging/audit.js` | Audit and access logging |

External configuration: `config/memory.js` exports `MEMORY_CONFIG`, a module-level constant governing composite ranking weights and stale detection thresholds, decoupled from server source to permit adjustment without code modification.

---

## 3. Persistence Layer: Schema Design and Indexing

All persistent state resides in PostgreSQL under the `agent_memory` schema. The DDL is defined in `lib/memory/memory-schema.sql`.

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
        vector embedding "OpenAI 1536, L2-normalized"
        boolean is_anchor
        timestamptz valid_from "Temporal validity start"
        timestamptz valid_to "Temporal validity end (NULL=current)"
        text superseded_by "Superseding fragment ID"
        timestamptz last_decay_at "Last decay application timestamp"
        text key_id "API key isolation (NULL=master)"
        float ema_activation "ACT-R EMA activation approximation (DEFAULT 0.0)"
        timestamptz ema_last_updated "Last EMA update timestamp"
    }
    fragment_links {
        bigserial id PK
        text from_id FK
        text to_id FK
        text relation_type
        integer weight "Link strength (co_retrieved accumulates +1)"
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

### 3.1 The `fragments` Table

The central relation. Each row represents one atomic unit of agent knowledge.

| Column | Type | Constraints | Semantics |
|--------|------|-------------|-----------|
| `id` | TEXT | PRIMARY KEY | Fragment identifier. Format: `frag-<16 hex chars>` (crypto.randomBytes) |
| `content` | TEXT | NOT NULL | Knowledge content. ≤300 characters; truncated with ellipsis on overflow |
| `topic` | TEXT | NOT NULL | Categorical label (e.g., `database`, `deployment`, `security`) |
| `keywords` | TEXT[] | NOT NULL DEFAULT '{}' | Search keywords; GIN-indexed. Auto-extracted via TF-based ranking when omitted |
| `type` | TEXT | NOT NULL, CHECK | `fact` / `decision` / `error` / `preference` / `procedure` / `relation` |
| `importance` | REAL | CHECK 0.0–1.0 | Type-specific defaults: `preference`=0.95, `error`=0.9, `decision`=0.8, `procedure`=0.7, `relation`=0.6, `fact`=0.5 |
| `content_hash` | TEXT | UNIQUE NOT NULL | First 16 hex characters of SHA-256 of the redacted, truncated content |
| `source` | TEXT | | Provenance identifier (session ID, tool name, file path) |
| `linked_to` | TEXT[] | DEFAULT '{}' | Adjacent fragment IDs; GIN-indexed for graph traversal |
| `agent_id` | TEXT | NOT NULL DEFAULT 'default' | Agent namespace; RLS isolation key |
| `access_count` | INTEGER | DEFAULT 0 | Retrieval frequency counter; input to `utility_score` computation |
| `accessed_at` | TIMESTAMPTZ | | Timestamp of most recent retrieval |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `ttl_tier` | TEXT | CHECK | `hot` / `warm` / `cold` / `permanent`. Inferred by `FragmentFactory._inferTTL` at creation |
| `estimated_tokens` | INTEGER | DEFAULT 0 | Token count under cl100k_base encoding; `chars / 4` approximation on encoder unavailability |
| `utility_score` | REAL | DEFAULT 1.0 | Composite utility estimate; updated by `MemoryEvaluator` and `MemoryConsolidator` |
| `verified_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp of last quality assessment |
| `embedding` | vector(1536) | | Dense vector via OpenAI `text-embedding-3-small`; L2-normalized to unit length before storage; NULL until generated asynchronously |
| `is_anchor` | BOOLEAN | DEFAULT FALSE | When `TRUE`: exempt from decay, TTL demotion, and expiration deletion |
| `valid_from` | TIMESTAMPTZ | DEFAULT NOW() | Temporal validity interval start. Lower bound for `asOf` point-in-time queries. |
| `valid_to` | TIMESTAMPTZ | | Temporal validity interval end. NULL indicates the currently active record. |
| `superseded_by` | TEXT | | ID of the fragment that supersedes this one. |
| `last_decay_at` | TIMESTAMPTZ | | Timestamp of most recent decay application. Enables idempotent decay: Δt is computed from this column rather than `created_at`. NULL triggers fallback to `COALESCE(accessed_at, created_at, NOW())`. |
| `key_id` | TEXT | FK → api_keys.id, ON DELETE SET NULL | Per-API-key memory isolation. NULL indicates the fragment was stored via the master key (`MEMENTO_ACCESS_KEY`) and is only accessible to master key requests. A non-null value restricts access to the specific API key that stored it. |
| `ema_activation` | FLOAT | DEFAULT 0.0 | ACT-R baseline activation EMA approximation. Updated by `incrementAccess()` via: `α × (Δt_sec)^{−0.5} + (1−α) × prev`, α=0.3. Used in `_computeRankScore()` to boost frequently-retrieved fragments. |
| `ema_last_updated` | TIMESTAMPTZ | | Timestamp of last EMA update. NULL triggers fallback to `created_at − 1 day`. |

**Index inventory:** `content_hash` (UNIQUE B-tree); `topic` (B-tree); `type` (B-tree); `keywords` (GIN); `importance DESC` (B-tree); `created_at DESC` (B-tree); `agent_id` (B-tree); `linked_to` (GIN); `(ttl_tier, created_at)` (composite B-tree); `source` (B-tree); `verified_at` (B-tree); `is_anchor WHERE is_anchor = TRUE` (partial B-tree); `valid_from` (B-tree); `(topic, type) WHERE valid_to IS NULL` (partial B-tree); `id WHERE valid_to IS NULL` (partial UNIQUE).

**HNSW vector index:** Conditional on `embedding IS NOT NULL`. Parameters: `m=16` (neighbor connections per node), `ef_construction=64` (search depth during index build), distance function `vector_cosine_ops`. Adjust `ef_construction` upward to improve recall at the cost of longer build time.

### 3.2 The `fragment_links` Table

Typed edge relation between fragments. The `linked_to` array on `fragments` provides fast single-hop adjacency; this table provides a normalized, queryable representation for relational operations and graph traversal.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY |
| `from_id` | TEXT | REFERENCES fragments(id) ON DELETE CASCADE |
| `to_id` | TEXT | REFERENCES fragments(id) ON DELETE CASCADE |
| `relation_type` | TEXT | CHECK: `related` / `caused_by` / `resolved_by` / `part_of` / `contradicts` / `superseded_by` / `co_retrieved` |
| `weight` | INTEGER | Link strength. `co_retrieved` links increment +1 on each co-recall event; defaults to 1. |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

UNIQUE constraint on `(from_id, to_id)` prevents duplicate edges — co-retrieval events increment `weight` instead of inserting a new row. B-tree indexes on both `from_id` and `to_id`.

`co_retrieved` links are created asynchronously by `GraphLinker.buildCoRetrievalLinks()` whenever a `recall` call returns ≥2 fragments in the same session. This implements a Hebbian associative learning mechanism: fragment pairs that are frequently co-retrieved accumulate higher `weight` values, strengthening their inferred association.

### 3.3 The `tool_feedback` Table

Utility assessments submitted via the `tool_feedback` MCP tool.

| Column | Type | Semantics |
|--------|------|-----------|
| `tool_name` | TEXT | Evaluated tool identifier |
| `relevant` | BOOLEAN | Whether results were pertinent to the stated intent |
| `sufficient` | BOOLEAN | Whether results were adequate for task completion |
| `suggestion` | TEXT | Free-text improvement suggestion |
| `context` | TEXT | Usage context summary |
| `session_id` | TEXT | Session identifier |
| `trigger_type` | TEXT | `sampled` (hook-initiated) / `voluntary` (agent-initiated, default) |
| `created_at` | TIMESTAMPTZ | |

### 3.4 The `task_feedback` Table

Session-granularity effectiveness assessments, populated by the `reflect` tool's `task_effectiveness` parameter.

| Column | Type | Semantics |
|--------|------|-----------|
| `session_id` | TEXT | NOT NULL |
| `overall_success` | BOOLEAN | NOT NULL |
| `tool_highlights` | TEXT[] | Tools of exceptional utility, with rationale |
| `tool_pain_points` | TEXT[] | Tools requiring improvement, with rationale |
| `created_at` | TIMESTAMPTZ | |

### 3.5 The `fragment_versions` Table

Immutable audit log of fragment state prior to each `amend` operation.

| Column | Type | Semantics |
|--------|------|-----------|
| `fragment_id` | TEXT | REFERENCES fragments(id) ON DELETE CASCADE |
| `content` | TEXT | Pre-amendment content |
| `topic` | TEXT | Pre-amendment topic |
| `keywords` | TEXT[] | Pre-amendment keywords |
| `type` | TEXT | Pre-amendment type |
| `importance` | REAL | Pre-amendment importance |
| `amended_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `amended_by` | TEXT | `agent_id` of the amending agent |

### 3.6 Row-Level Security

The `fragments` table has RLS enabled. The isolation policy:

```sql
CREATE POLICY fragment_isolation_policy ON agent_memory.fragments
    USING (
        agent_id = current_setting('app.current_agent_id', true)
        OR agent_id = 'default'
        OR current_setting('app.current_agent_id', true) IN ('system', 'admin')
    );
```

Access is granted to: (1) fragments owned by the requesting agent; (2) fragments in the `default` namespace, shared across all agents; (3) sessions identified as `system` or `admin` (maintenance access).

The isolation context is set per-transaction via `SET LOCAL app.current_agent_id = $1` before query execution. In multi-agent deployments requiring strict isolation, pass explicit `agentId` on all `remember` calls and audit the `default`-namespace periodically.

### 3.7 API Key-Based Memory Isolation

The `key_id` column provides an additional isolation layer orthogonal to the agent-level RLS policy. Fragments stored via the master key (`MEMENTO_ACCESS_KEY`) carry `key_id = NULL` and are accessible only to master key requests. Fragments stored by a provisioned DB API key carry `key_id = <key UUID>` and are visible only to requests authenticated with that specific key.

This model enables per-key memory partitioning in multi-tenant or multi-agent deployments. API keys are provisioned and managed through the Admin SPA at `/v1/internal/model/nothing`. The SPA shell (HTML and images) is served without authentication to allow the login form to render; all data API endpoints under the same prefix require master key authentication via Authorization Bearer header or `?key=` query parameter. The raw key (`mmcp_<slug>_<32 hex chars>`) is returned exactly once on creation and is never stored; the database retains only the SHA-256 hash. Key status, daily rate limits, and usage statistics are tracked in the `api_keys` and `api_key_usage` tables created by migration-003.

### API Key Groups

Keys in the same group share the same fragment isolation scope. Use this when multiple agents (Claude Code, Codex, Gemini, etc.) need to share one project's memory.

- N:M mapping: one key can belong to multiple groups (`api_key_group_members` table)
- Isolation resolution: `COALESCE(group_id, api_keys.id)` as effective_key_id at auth time
- Ungrouped keys: existing behavior preserved (isolated by own key id)

Admin REST endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../groups` | List groups (with key_count) |
| POST | `.../groups` | Create group (`{ name, description? }`) |
| DELETE | `.../groups/:id` | Delete group (memberships CASCADE) |
| GET | `.../groups/:id/members` | List group members |
| POST | `.../groups/:id/members` | Add key to group (`{ key_id }`) |
| DELETE | `.../groups/:gid/members/:kid` | Remove key from group |

---

## 4. Prompts: Operational Guidance for AI

Prompts are pre-defined guidelines that help the AI use the memory system more effectively.

| Name | Description | Key Role |
|------|-------------|----------|
| `analyze-session` | Analyze session activity | Guide the AI to extract and store valuable decisions, errors, and procedures from the current conversation. |
| `retrieve-relevant-memory` | Memory retrieval guide | Assist in finding optimal context by combining keyword and semantic search for a specific topic. |
| `onboarding` | System onboarding | Self-guide for the AI to learn when and how to use Memento MCP tools. |

---

## 5. Resources

MCP resources exposing real-time system state.

| URI | Description | Data Source |
|-----|-------------|-------------|
| `memory://stats` | System Statistics | Counts by type/tier and average utility scores from the `fragments` table. |
| `memory://topics` | Topic List | List of all unique `topic` labels in the `fragments` table. |
| `memory://config` | System Configuration | Weights and TTL thresholds defined in `MEMORY_CONFIG`. |
| `memory://active-session` | Session Activity Log | Tool invocation history for the current session from `SessionActivityTracker` (Redis). |

---

## 6. Retrieval Architecture: The Three-Tier Cascade

### 6.1 Retrieval Flow Diagram

![Retrieval Flow](assets/images/retrieval_flow.svg)

Fragment retrieval is query-adaptive: the execution path branches on whether a `text` (semantic) parameter is present, preserving fast cascade behavior for structured queries while applying parallel execution and RRF fusion for semantic queries.

```
recall(keywords, topic, type, text, ...)
          │
          ▼
┌─────────────────────────────────────────┐
│  L1: Redis SINTER (always runs first)   │
│  keys: keywords:<kw> (Set per keyword)  │
│  op:   SINTER → fragment ID set         │
│  cost: O(N·K), in-memory, sub-ms        │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────────────┐
       │ text param?            │
       │ No (structured query)  │ Yes (semantic query)
       ▼                        ▼
┌────────────┐        ┌─────────────────────────────┐
│ L2: PG GIN │        │ L2 ‖ L3  (Promise.all)      │
│ (sequential│        │ L2: PostgreSQL GIN           │
│  after L1) │        │ L3: Embed + HNSW cosine      │
└─────┬──────┘        │ (L2 latency absorbed by L3)  │
      │               └────────────┬────────────────┘
      │                            │ RRF Fusion
      │                            │ w_L1=2.0, k=60
      └──────────────┬─────────────┘
                     ▼
              Merge + Composite Rank
              → tokenBudget enforcement
              → includeLinks (1-hop)
              → return fragments
```

### 4.1 L1: Redis Set Intersection

Upon fragment creation, `FragmentIndex` synchronously updates one Redis Set per keyword: each Set keyed `keywords:<keyword>` stores the IDs of all fragments annotated with that keyword. Multi-keyword retrieval reduces to SINTER across the corresponding Sets — time complexity O(N·K) where N is the cardinality of the smallest Set and K is the number of keywords. Execution is sub-millisecond for typical workloads given Redis's in-memory storage model. When Redis is unavailable, L1 is bypassed entirely and retrieval proceeds directly to L2.

### 4.2 L2: PostgreSQL GIN-Indexed Array Query

L2 always executes after L1, regardless of L1 result count. The `keywords` column carries a Generalized Inverted Index (GIN), enabling the array overlap operator `keywords && ARRAY[...]` to execute as an index scan. GIN indexes decompose each array into constituent elements and maintain posting lists per element; the overlap operator resolves to a set intersection over posting lists, returning rows containing at least one matching keyword. No sequential scan is performed. L1 results are augmented with L2 results rather than L2 being a fallback gated on L1 failure.

### 4.3 L3: pgvector HNSW Cosine Similarity Search

L3 is invoked exclusively when the `text` parameter is present and an embedding API key is configured. Insufficient L1/L2 result count alone does not trigger L3. The query text is encoded via the OpenAI Embeddings API (`text-embedding-3-small`, 1536 dimensions) and the resulting dense vector is issued against the HNSW index:

```sql
SELECT *, 1 - (embedding <=> $1) AS similarity
FROM agent_memory.fragments
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1
LIMIT $2
```

The `threshold` parameter filters results where computed cosine similarity falls below the stated minimum. L1/L2 results, which carry no similarity score, are exempt from threshold filtering.

When `OPENAI_API_KEY` is absent or the embedding API call fails, L3 is unavailable. Fragments stored without embeddings are silently excluded from L3 results; they remain accessible via L1 and L2.

### 4.4 Result Merging: RRF Hybrid Fusion and Composite Ranking

When the `text` parameter is present, L2 and L3 execute in parallel via `Promise.all` and their results are fused using Reciprocal Rank Fusion (RRF):

```
rrfScore(f) = Σ_tier weight(tier) / (k + rank_tier(f) + 1)
```

where `k = 60` (MEMORY_CONFIG.rrfSearch.k) is the denominator stabilization constant and L1 results receive a `l1WeightFactor = 2.0` multiplier over L2/L3 to prioritize exact keyword matches. Fragments appearing only in the L1 tier without content fields (not returned by L2 or L3 queries) are filtered out before the final result set is assembled. The `_rrfScore` internal field is stripped before returning results to MCP clients.

When `text` is absent (structured query using keywords/topic/type only), L3 is not invoked. The response is assembled from L1 and L2 results only, preserving the low-latency path.

After RRF fusion, composite ranking is applied:

```
effectiveImportance(f) = min(1.0, importance(f) + computeEmaRankBoost(ema_activation(f)) × 0.5)
rank(f) = importanceWeight × effectiveImportance(f) + recencyWeight × recency_score(f) + semanticWeight × similarity(f)
```

`computeEmaRankBoost(ema) = 0.3 × (1 − e^{−ema})` — maximum additional boost of 0.15 for the most frequently retrieved fragments. `importanceWeight = 0.4`, `recencyWeight = 0.3`, `semanticWeight = 0.3` by default. Adjust via `MEMORY_CONFIG.ranking`.

Token budget enforcement follows ranking: fragments are accumulated in rank order and the sequence is truncated when cumulative `estimated_tokens` exceeds `tokenBudget` (default: 1000). Token counts are computed using `js-tiktoken` with the `cl100k_base` encoding via `encodingForModel("gpt-4")`; when the encoder is unavailable at runtime, a `chars / 4` approximation is applied as fallback.

### 4.5 Linked Fragment Retrieval

When `includeLinks = true` (default), the result set is augmented with one-hop neighbors from `fragment_links`. The `linkRelationType` parameter constrains which edge types are followed; when unspecified, `caused_by`, `resolved_by`, and `related` edges are included. The total number of appended linked fragments is bounded by `MEMORY_CONFIG.linkedFragmentLimit` (default: 10).

### 4.6 Performance Characteristics

Estimated latencies based on underlying data structure properties. Actual production latencies vary with hardware, network, index parameters, and store cardinality.

| Tier / Operation | Time Complexity | Expected Latency | Dominant Cost |
|-----------------|-----------------|-----------------|---------------|
| L1 Redis SINTER | O(N·K) | < 1 ms | Network RTT to Redis; N = smallest Set cardinality, K = keyword count |
| L2 PostgreSQL GIN | O(N) per posting list | 1–10 ms | GIN posting list intersection; no sequential scan |
| L3 pgvector HNSW query | O(log n) | 1–5 ms | HNSW graph traversal; n = embedded fragment count |
| L3 embedding generation | network-bound | 50–200 ms | OpenAI Embeddings API round-trip |
| Full cascade (L1 → L3, cached embedding) | — | 5–20 ms | Merge + composite ranking: O(m log m), m = merged result count |
| Full cascade (live embedding) | — | 60–220 ms | Dominated by OpenAI API call |
| MemoryEvaluator job | process-bound | 200–2000 ms | Gemini CLI subprocess; fully asynchronous, non-blocking |
| NLI inference (warm) | O(n) | 50–200 ms | mDeBERTa ONNX CPU; n = token count of input pair |
| Consolidation pipeline (< 10⁴ fragments) | O(n) most stages | < 1 s excl. API calls | Stage 9 embedding backfill bounded by OpenAI call count |

Three further observations merit attention. First, the HNSW index parameters (m=16, ef_construction=64) represent a conservative default; increasing `ef_construction` at build time improves recall at the cost of index size and construction latency. The query-time recall parameter `ef` can be tuned per-request via pgvector's `SET hnsw.ef_search`. Second, composite ranking (§4.4) is activated only when the fragment store exceeds `MEMORY_CONFIG.ranking.activationThreshold` (default: 100); below this threshold, results are returned in creation-descending order, eliminating the sort cost entirely. Third, the token budget enforcement loop is O(k) in the number of returned fragments k, not in total store cardinality n, and contributes negligible latency at typical retrieval set sizes.

---

## 5. Fragment Lifecycle: TTL Model and Scope Semantics

### 5.1 Lifecycle State Transition Diagram

![Fragment Lifecycle](assets/images/fragment_lifecycle.svg)

### 5.2 Scope vs. TTL Tier: A Critical Distinction

The `scope` parameter of the `remember` tool and the `ttl_tier` column of `fragments` are orthogonal concepts that share superficially similar vocabulary. Their distinction must be understood clearly to avoid operational errors.

**`scope`** governs *where* a fragment is stored:
- `scope: "permanent"` (default): the fragment is written to the main `fragments` table and persists indefinitely, subject to normal lifecycle management.
- `scope: "session"`: the fragment is written to the working memory partition and is expunged when the session terminates.

**`ttl_tier`** governs *how* the `MemoryConsolidator` treats a fragment over time. The initial tier assignment is computed by `FragmentFactory._inferTTL` based on `type` and `importance` at creation time — independently of `scope`:

| Condition (evaluated in order) | Assigned `ttl_tier` |
|--------------------------------|---------------------|
| `type === "preference"` | `permanent` |
| `importance >= 0.8` | `permanent` |
| `type === "error"` OR `type === "procedure"` | `hot` |
| `importance >= 0.5` | `warm` |
| otherwise | `cold` |

Consequently, `scope: "permanent"` does not imply `ttl_tier: "permanent"`. A `fact` fragment with `importance: 0.6` stored with `scope: "permanent"` receives `ttl_tier: "warm"` and is subject to eventual demotion to `cold` and expiration. A `preference` fragment receives `ttl_tier: "permanent"` regardless of the explicitly supplied `importance` value, and will never be expired by the consolidation pipeline.

The `is_anchor` flag provides an orthogonal mechanism for operator-forced permanence: any fragment with `is_anchor = true` is unconditionally exempt from all lifecycle management operations regardless of its `ttl_tier` value.

### 5.2 TTL Tier Semantics

| Tier | Semantics |
|------|-----------|
| `hot` | Recently created or frequently accessed; protected from demotion for a short window |
| `warm` | Default long-term tier; subject to gradual importance decay and eventual cold demotion |
| `cold` | Low-activity; subject to expiration after type-specific stale thresholds |
| `permanent` | Exempt from all consolidation operations |

Stale detection thresholds (days without access before cold-tier expiration): `procedure`=30, `fact`=60, `decision`=90, all other types=60. Configurable via `MEMORY_CONFIG.staleThresholds`.

---

## 6. MCP Tool Interface

Twelve tools are registered. All are defined in `lib/tools/memory.js` and registered via `lib/tool-registry.js`. No database-layer tools are exposed through the MCP interface.

### 6.1 Tool Interaction Patterns

The twelve tools form three functional clusters:

**Storage cluster:** `remember` persists new knowledge; `amend` modifies existing fragments in place with version archival; `link` establishes typed edges between fragments; `forget` removes fragments.

**Retrieval cluster:** `recall` executes the three-tier cascade; `context` loads session-initialization memory; `graph_explore` traverses causal chains from an error fragment.

**Maintenance and telemetry cluster:** `reflect` converts a session summary to a fragment set at session close (also triggered automatically on session termination via `AutoReflect`); `tool_feedback` records instrument-level utility assessments; `memory_stats` returns aggregate store statistics; `memory_consolidate` triggers the eighteen-step maintenance pipeline.

A canonical session workflow:

```
session open    → context(agentId, tokenBudget)
                  [loads preference + error + procedure fragments]
                  [hints about unreflected prior sessions, if any]

during session  → recall(keywords/text)
                  remember(content, topic, type)
                    └─ auto-link: pgvector similarity scan creates
                       related / resolved_by / superseded_by edges
                  link(fromId, toId, relationType)
                  amend(id, ...) as knowledge evolves
                  tool_feedback(tool_name, relevant, sufficient)

session close   → reflect(summary, decisions, errors_resolved, ...)
                  [converts summary to typed fragments for next session]
                  (or) AutoReflect triggers if agent does not call reflect
                    └─ Gemini CLI summary, or minimal fallback
```

### 6.2 `remember`

Persists a typed knowledge fragment. `FragmentFactory._redactPII` is applied to `content` before storage, masking four categories via regex:

1. **API keys**: patterns matching `sk-[a-zA-Z0-9]{32,}` (OpenAI) and `AIza[0-9A-Za-z\-_]{35}` (Google) → `[REDACTED_API_KEY]`
2. **Email addresses**: RFC 5321 local-part + domain pattern → `[REDACTED_EMAIL]`
3. **Password fields**: `password|passwd|pwd|비밀번호|비번` followed by `:` or `=` and a value → `[REDACTED_PWD]`
4. **Korean mobile numbers**: `01[016789][-\s]?\d{3,4}[-\s]?\d{4}` → `[REDACTED_PHONE]`

Masking is purely destructive; the original content is never stored and cannot be recovered. The `content_hash` is computed from the *redacted, truncated* content, so duplicate detection operates on the masked representation. PII masking applies to the `content` field only; `topic`, `keywords`, and `source` are not processed.

Keyword extraction, when `keywords` is omitted, applies a term-frequency ranking over unigrams after removing a bilingual (Korean/English) stopword list, returning up to five terms with highest frequency.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `content` | string | Y | Fragment content. ≤300 characters; truncated with ellipsis on overflow. PII masking applied. |
| `topic` | string | Y | Categorical topic label |
| `type` | string | Y | `fact` / `decision` / `error` / `preference` / `procedure` / `relation` |
| `keywords` | string[] | | Search keywords. Auto-extracted via TF ranking when omitted |
| `importance` | number | | [0.0, 1.0]. Type-specific default when omitted. See §3.1 for defaults. |
| `source` | string | | Provenance identifier |
| `linkedTo` | string[] | | Fragment IDs to link at creation time |
| `scope` | string | | `permanent` (default) / `session`. Controls storage layer, not TTL tier. |
| `isAnchor` | boolean | | Exempts from decay, TTL demotion, and expiration when `true` |
| `agentId` | string | | Agent identifier for RLS context. Defaults to `"default"` namespace when omitted. |

Returns: `{ success: true, id: string, created: boolean }`. `created: false` indicates the content hash already existed; the existing fragment is returned.

**Auto-linking behavior:** After successful insertion, `MemoryManager._autoLinkOnRemember` queries pgvector directly for fragments in the same topic with cosine similarity > 0.7. Up to three edges are created automatically: `related` (similarity > 0.7), `resolved_by` (new error fragment resolving a prior error), or `superseded_by` (same type, similarity > 0.85, newer timestamp). This operates only when embeddings are present; fragments without embeddings are skipped. The auto-link step is non-blocking: failures do not affect the `remember` response.

### 6.3 `recall`

Executes the three-tier retrieval cascade. Parameters may be combined freely.

| Parameter | Type | Description |
|-----------|------|-------------|
| `keywords` | string[] | L1 Redis Set intersection keys; also applied as L2 filter |
| `topic` | string | Topic filter applied at all tiers |
| `type` | string | Type filter applied at all tiers |
| `text` | string | Natural language query; forces L3 semantic retrieval and enables parallel L2+L3 execution with RRF merge |
| `tokenBudget` | number | Maximum cumulative token count. Default: 1000 |
| `includeLinks` | boolean | Append 1-hop linked neighbors. Default: `true` |
| `linkRelationType` | string | Edge type filter for linked neighbors. Default: `caused_by`, `resolved_by`, `related` |
| `threshold` | number | Minimum cosine similarity for L3 results [0.0, 1.0]. L1/L2 results are unaffected. |
| `asOf` | string | ISO 8601 datetime (e.g., `"2026-01-15T00:00:00Z"`). Enables point-in-time retrieval: returns only fragments where `valid_from ≤ asOf AND (valid_to IS NULL OR valid_to > asOf)`. Useful for auditing knowledge state at a specific historical moment. |
| `agentId` | string | Agent identifier |

### 6.4 `forget`

Deletes fragments by ID or by topic. `permanent`-tier fragments require `force: true`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Delete a specific fragment by ID |
| `topic` | string | Delete all fragments with the specified topic |
| `force` | boolean | Permit deletion of `permanent`-tier fragments. Default: `false` |
| `agentId` | string | Agent identifier |

### 6.5 `link`

Creates a typed directed edge. Inserts a row into `fragment_links` and appends `toId` to `from_id.linked_to`.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `fromId` | string | Y | Source fragment ID |
| `toId` | string | Y | Target fragment ID |
| `relationType` | string | | `related` / `caused_by` / `resolved_by` / `part_of` / `contradicts`. Default: `related` |
| `agentId` | string | | Agent identifier |

### 6.6 `amend`

Modifies a fragment in place. Pre-modification state is archived to `fragment_versions`. Fragment ID and all edge relations are preserved.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `id` | string | Y | Target fragment ID |
| `content` | string | | Replacement content. PII masking applied. Truncated at 300 characters. |
| `topic` | string | | Replacement topic |
| `keywords` | string[] | | Replacement keyword list |
| `type` | string | | Replacement type |
| `importance` | number | | Replacement importance [0.0, 1.0] |
| `isAnchor` | boolean | | Modify anchor status |
| `supersedes` | boolean | | Creates `superseded_by` edge from this fragment to the original; reduces original's importance |
| `agentId` | string | | Agent identifier |

### 6.7 `reflect`

Converts a session summary into a structured fragment set at session termination. Each non-null list parameter generates typed fragments: `decisions` → `decision`; `errors_resolved` → `error`; `new_procedures` → `procedure`; `open_questions` → `fact`. The `summary` string is always persisted as a `fact` fragment.

**Session consolidation:** When `sessionId` is provided, fragments indexed for that session (Redis `frag:sess:{sessionId}` and Working Memory) are consolidated and used to populate missing parameters. Callable with `sessionId` alone; `summary` is optional in that case.

**Automatic reflection:** When a session terminates (explicit close, expiration, or server shutdown) without the agent having called `reflect`, the `AutoReflect` module triggers automatically. If Gemini CLI is available, it generates a structured summary from `SessionActivityTracker` logs (tools called, keywords searched, fragments created/accessed) and invokes `reflect` with the synthesized parameters. If Gemini CLI is unavailable, a minimal `fact` fragment summarizing the session is created, and the session is marked as "unreflected" for potential future AI-driven reflection. The `context` tool detects unreflected sessions and injects a hint into the AI's prompt.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `summary` | string | | Free-text session summary. Auto-generated from session fragments when `sessionId` is provided |
| `sessionId` | string | | Session identifier. When provided, only fragments from this session are consolidated |
| `decisions` | string[] | | Architectural/technical decisions reached this session |
| `errors_resolved` | string[] | | Errors resolved this session with resolution description |
| `new_procedures` | string[] | | New procedures or workflows established this session |
| `open_questions` | string[] | | Unresolved questions or deferred work items |
| `agentId` | string | | Agent identifier |
| `task_effectiveness` | object | | `{ overall_success: boolean, tool_highlights: string[], tool_pain_points: string[] }`. Persisted to `task_feedback`. |

### 6.8 `context`

Loads memory context at session initialization. Returns Core Memory (high-importance fragments, prefix-injected) and, when `sessionId` is specified, Working Memory (session-scoped fragments appended during the current session). Additionally queries `SessionActivityTracker` for unreflected prior sessions and, when found, injects a hint into the returned context prompting the AI to call `reflect` for those sessions.

| Parameter | Type | Description |
|-----------|------|-------------|
| `tokenBudget` | number | Maximum token count for loaded context. Default: 2000 |
| `types` | string[] | Fragment types to include. Default: `["preference", "error", "procedure"]` |
| `sessionId` | string | Session identifier for Working Memory retrieval |
| `agentId` | string | Agent identifier |

### 6.9 `tool_feedback`

Records a utility assessment for a previously executed tool invocation.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `tool_name` | string | Y | Identifier of the evaluated tool |
| `relevant` | boolean | Y | Whether results were pertinent to the stated intent |
| `sufficient` | boolean | Y | Whether results were adequate for task completion |
| `suggestion` | string | | Improvement suggestion. ≤100 characters recommended |
| `context` | string | | Usage context summary. ≤50 characters recommended |
| `session_id` | string | | Session identifier |
| `trigger_type` | string | | `sampled` (hook-initiated) / `voluntary` (agent-initiated, default) |

### 6.10 `memory_stats`

Returns aggregate statistics: total fragment count, TTL tier distribution, type-wise counts, embedding coverage ratio, mean utility scores. No parameters.

Response includes a `searchLatencyMs` key with rolling P50/P90/P99 latencies (ms) per retrieval layer, sampled over the last 100 searches:

```json
"searchLatencyMs": {
  "L1":    { "p50": 0,   "p90": 1,   "p99": 7,   "count": 26 },
  "L2":    { "p50": 4,   "p90": 175, "p99": 595, "count": 26 },
  "L3":    { "p50": 159, "p90": 595, "p99": 595, "count": 10 },
  "total": { "p50": 8,   "p90": 177, "p99": 597, "count": 26 }
}
```

Response also includes an `evaluation` key — implicit IR quality metrics derived from `tool_feedback` and `task_feedback` signals, requiring no labeled dataset:

| Field | Description |
|-------|-------------|
| `rolling_precision_at_5` | Rolling Precision@5 over the last 100 sessions. Approximated by `relevant=true` ratio in `tool_feedback`. |
| `sufficient_rate` | Ratio of `sufficient=true` feedback events (0–1) |
| `sample_sessions` | Number of sessions used in the Precision@5 estimate |
| `task_success_rate` | `task_feedback.overall_success` ratio over a 30-day window |
| `task_sessions` | Number of task sessions used in the success rate estimate |

### 6.11 `memory_consolidate`

Triggers the eighteen-step consolidation pipeline synchronously. Returns per-stage processing counts including NLI statistics (`nliResolvedDirectly`, `nliSkippedAsNonContra`). No parameters. See §8.

### 6.12 `graph_explore`

Performs a one-hop traversal of the causal relation subgraph from a specified origin fragment, following `caused_by` and `resolved_by` edges. Intended for root cause analysis starting from an `error` fragment.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `startId` | string | Y | Origin fragment ID. `error`-typed fragments are the canonical input. |
| `agentId` | string | | Agent identifier |

### 6.13 `fragment_history`

Returns the full change history for a fragment: all prior versions created by `amend` and the `superseded_by` chain.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `id` | string | Y | Fragment ID to query history for |

---

## 7. Asynchronous Quality Evaluation: MemoryEvaluator

`MemoryEvaluator` is a singleton background worker started at server startup via `getMemoryEvaluator().start()` and halted during graceful shutdown. It implements a polling loop over the Redis queue `memory_evaluation` at a fixed interval of 5,000 ms.

```
server start
    │
    └─► MemoryEvaluator.start()
              │
              └─► _loop()
                    ├── popFromQueue("memory_evaluation")
                    │       │ job present
                    │       └──► evaluate(job)
                    │               ├── Gemini CLI call (geminiCLIJson)
                    │               └── UPDATE fragments SET utility_score, verified_at
                    │       │ queue empty
                    │       └──► sleep(5000ms)
                    └── (repeat)
```

When a fragment is persisted via `remember`, its identifier is enqueued for evaluation. The evaluation path is fully decoupled from the `remember` call to eliminate latency from the synchronous response path. `MemoryEvaluator` assesses informational value, specificity, and actionability of the stored content and updates `utility_score` and `verified_at` accordingly.

The evaluator uses the Gemini CLI (`geminiCLIJson`) rather than the Gemini REST API. If the CLI is not installed (`isGeminiCLIAvailable()` returns `false`), evaluation is skipped entirely — the fragment retains its default `utility_score` of 1.0, and no error is surfaced. When the CLI call fails (timeout, malformed response), the job is processed without updating the fragment and the worker continues. The queue is not retried automatically on transient failures in the current implementation; operators requiring retry semantics should instrument the Redis queue externally.

---

## 8. Consolidation Pipeline: MemoryConsolidator

The consolidation pipeline is an eighteen-step sequential maintenance procedure (11 main stages + 7 sub-steps).

```
memory_consolidate
        │
        ├── Stage 1:  TTL tier transitions (hot→warm→cold, anchors exempt)
        ├── Stage 2:  importance decay (PostgreSQL POWER() batch SQL, type-specific half-lives, idempotent via last_decay_at, anchors exempt)
        ├── Stage 3:  expired fragment deletion (stale thresholds)
        ├── Stage 4:  deduplication (content_hash collision → merge, retain highest-importance)
        ├── Stage 5:  missing embedding backfill (up to 5 per cycle)
        ├── Stage 6:  utility_score recomputation: importance × (1 + ln(max(access_count, 1)))
        ├── Stage 6.5: anchor auto-promotion (access_count ≥ 10 + importance ≥ 0.8)
        ├── Stage 7:  contradiction detection ──── 3-stage hybrid ────
        │                 ├─ 7a: pgvector cosine similarity > 0.85 (candidate filter)
        │                 ├─ 7b: NLI classification (mDeBERTa ONNX, CPU)
        │                 │       ├─ contradiction ≥ 0.8 → resolve immediately
        │                 │       ├─ entailment ≥ 0.6 → skip (not contradictory)
        │                 │       └─ uncertain → escalate to Stage 7c
        │                 └─ 7c: Gemini CLI adjudication (domain/numerical contradictions)
        │                         └─ CLI unavailable → queue to Redis pending list
        ├── Stage 7.5: pending contradiction reprocessing (Redis queue, max 10 per cycle)
        ├── Stage 8:  feedback report generation (tool_feedback/task_feedback aggregation)
        ├── Stage 8.5: feedback-adaptive importance calibration (_calibrateByFeedback)
        │               Joins tool_feedback sessions with SessionActivityTracker co-recall history.
        │               sufficient=true → +5%; sufficient=false, relevant=true → −2.5%; relevant=false → −5%.
        │               Learning rate 0.05, clipped to [0.05, 1.0]. is_anchor=true exempt.
        ├── Stage 9:  Redis index pruning + stale fragment collection
        └── Stage 10: aggregate statistics (per-stage counts → return value)
```

**Stage 4 — Deduplication detail:** When multiple fragments share a `content_hash`, the highest-importance fragment is designated the surviving record. All `fragment_links` referencing duplicate fragment IDs are updated to reference the surviving ID before the duplicates are deleted.

**Stage 7 — Contradiction detection detail (3-stage hybrid):**

The contradiction detection pipeline processes only fragments created since the last check (tracked via Redis key `frag:contradiction_check_at`). For each new fragment, candidates are retrieved from the same topic with pgvector cosine similarity > 0.85 (Stage 7a).

Stage 7b applies the NLI classifier (`NLIClassifier.js`) to each candidate pair. The mDeBERTa model produces entailment/contradiction/neutral probabilities in ~50-200ms on CPU. High-confidence contradictions (score >= 0.8) are resolved immediately without an LLM call — this handles clear logical contradictions such as "the server never restarts" vs. "the server restarts daily." Clear entailments (score >= 0.6) are skipped as non-contradictory. This stage typically eliminates 50-70% of candidate pairs from requiring LLM evaluation.

Stage 7c escalates NLI-uncertain cases to Gemini CLI for contextual adjudication. This handles numerical contradictions (e.g., "TTL is 3600s" vs. "TTL is 300s") and domain-specific conflicts that NLI models cannot reason about. When Gemini CLI is unavailable, pairs with similarity > 0.92 are queued to Redis (`frag:pending_contradictions`) for later reprocessing in Stage 7.5.

Confirmed contradictions trigger: (1) a `contradicts` edge in `fragment_links`; (2) a `superseded_by` edge from the older to the newer fragment; (3) importance halving of the older fragment (anchors exempt). The timestamp is updated only for successfully processed fragments, ensuring failed Gemini calls do not cause fragments to be skipped in subsequent cycles.

---

## Contradiction Detection Pipeline

A 3-stage hybrid pipeline that suppresses O(N²) LLM comparison costs while maintaining precision.

```
On new fragment insertion
        ↓
pgvector cosine similarity > 0.85 candidate filter
        ↓
mDeBERTa NLI (in-process ONNX / external HTTP service)
  ├── contradiction ≥ 0.8  → resolved immediately (superseded_by link + valid_to update)
  ├── entailment   ≥ 0.6   → confirmed non-contradiction
  └── ambiguous            → Gemini CLI escalation
        ↓
Preserve knowledge via temporal columns (valid_from/valid_to, superseded_by)
```

- **Cost-efficient**: 99% of candidates handled by NLI; LLM called only for numeric/domain contradictions
- **Non-destructive**: Version control via temporal columns instead of fragment deletion
- **Implementation**: `lib/memory/NLIClassifier.js`, `lib/memory/MemoryConsolidator.js`
- **Env var**: `NLI_SERVICE_URL` — if unset, ONNX in-process mode is used (~280MB, downloaded on first run)

---

## 9. Fault Tolerance and Degradation Behavior

The system is designed to degrade gracefully rather than fail hard when external dependencies are unavailable.

### 9.1 Redis Unavailability

When `REDIS_ENABLED=false` (the default for minimal installations), Redis is not connected and the `/health` endpoint reports `redis.status: "disabled"` with HTTP 200 — this is not considered a degraded state.

When `REDIS_ENABLED=true` but the Redis client is not connected or returns an error:
- The `/health` endpoint reports `redis.status: "down"` and returns HTTP 503.
- **L1 retrieval** is skipped entirely; `recall` proceeds directly to L2.
- **Working Memory writes** (`scope: "session"`) fail silently or throw; session-scoped fragments are not persisted.
- **MemoryEvaluator** cannot dequeue jobs; the worker enters its sleep interval and retries on the next polling cycle.
- `memory_stats` and `memory_consolidate` may report degraded statistics for Redis-backed counters.

### 9.2 PostgreSQL Connection Failure

PostgreSQL is a hard dependency. Connection pool exhaustion or server unavailability causes `remember`, `recall`, `forget`, `amend`, and all maintenance operations to throw exceptions, which are caught by the tool handler and returned as `{ success: false, error: <message> }` to the MCP client. The `/health` endpoint reports `database.status: "down"` and returns HTTP 503, enabling load balancer health checks to route traffic appropriately.

### 9.3 OpenAI Embedding API Failure

When embedding generation fails (network error, invalid API key, rate limit, quota exhaustion):
- The fragment is stored without an embedding (`embedding` column remains NULL).
- L3 vector search is unavailable for that fragment until the embedding is backfilled by a subsequent `memory_consolidate` Stage 9 run.
- L1 and L2 retrieval continue to function normally.
- No error is surfaced to the `remember` caller; the operation is reported as successful.

### 9.4 Gemini CLI Unavailability

When the Gemini CLI is not installed or fails:
- **MemoryEvaluator** skips evaluation entirely; the fragment retains its initial `utility_score` of 1.0.
- **Contradiction detection** falls back to NLI-only mode. High-confidence NLI contradictions are still resolved; uncertain cases with similarity > 0.92 are queued to Redis pending list for later reprocessing when the CLI becomes available.
- **AutoReflect** creates a minimal `fact` fragment summarizing session activity and marks the session as "unreflected" rather than generating a full structured summary.

### 9.5 NLI Model Unavailability

When the NLI model (`NLIClassifier.js`) fails to load (download failure, ONNX runtime error, memory constraint):
- Contradiction detection falls back to the pre-NLI behavior: all candidate pairs are sent directly to Gemini CLI, or queued to Redis pending list when CLI is also unavailable.
- The model load failure is cached; subsequent calls return `null` immediately without retry. Server restart is required to re-attempt model loading.
- All other system functionality is unaffected.

### 9.6 Token Encoder Unavailability

If `js-tiktoken` fails to initialize the `cl100k_base` encoder at runtime, `FragmentFactory` falls back to a `Math.ceil(text.length / 4)` character-based approximation. This approximation overestimates token count for CJK-heavy content and underestimates for heavily punctuated ASCII. Operators storing predominantly Korean or Chinese content should ensure the encoder initializes correctly to avoid systematic `tokenBudget` miscalculation.

---

## 10. Configuration

### 10.1 Memory System Configuration

`config/memory.js` exports a single named constant:

```js
export const MEMORY_CONFIG = {
  ranking: {
    // Heuristic defaults. importanceWeight + recencyWeight must equal 1.0.
    // Adjust for domain-specific retrieval characteristics.
    importanceWeight   : 0.6,
    recencyWeight      : 0.4,
    activationThreshold: 100   // Composite ranking activates above this fragment count
  },
  staleThresholds: {
    // Days of inactivity before cold-tier expiration.
    procedure: 30,
    fact      : 60,
    decision  : 90,
    default   : 60
  },
  halfLifeDays: {
    // Exponential decay half-lives in days. importance × 2^(−Δt/halfLife).
    // Δt measured from last_decay_at (idempotent); falls back to accessed_at / created_at.
    procedure : 30,
    fact      : 60,
    decision  : 90,
    error     : 45,
    preference: 120,
    relation  : 90,
    default   : 60
  },
  rrfSearch: {
    k             : 60,   // RRF denominator constant. Higher k reduces top-rank dominance.
    l1WeightFactor: 2.0   // Multiplier applied to L1 Redis results for priority injection.
  },
  linkedFragmentLimit: 10  // Max linked neighbors returned per recall
};
```

`halfLifeDays` controls the exponential decay rate independently of `staleThresholds`; a fragment may still be active (not yet cold) while its importance has already decayed significantly. The `rrfSearch.k = 60` default follows the canonical Cormack, Clarke, and Buettcher (2009) recommendation for web retrieval; domain-specific corpora with tighter rank distributions may benefit from lower values.

### 10.2 Environment Variables

#### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `57332` | TCP port for the HTTP listener |
| `MEMENTO_ACCESS_KEY` | (empty) | Bearer token for authentication. Authentication disabled when empty. |
| `SESSION_TTL_MINUTES` | `60` | Session expiration interval in minutes |
| `LOG_DIR` | `/var/log/mcp` | Winston log file directory |
| `ALLOWED_ORIGINS` | (empty) | Comma-separated allowed Origin values. All origins permitted when empty. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limiting window size in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `120` | Maximum requests per IP within the window |
| `OAUTH_ALLOWED_REDIRECT_URIS` | (empty) | OAuth redirect_uri allowed prefixes (comma-separated). When unset, only localhost redirect URIs are permitted. |

#### PostgreSQL

`POSTGRES_*` variables take precedence over `DB_*` equivalents. Both forms are accepted.

| Variable | Description |
|----------|-------------|
| `POSTGRES_HOST` / `DB_HOST` | Database server hostname |
| `POSTGRES_PORT` / `DB_PORT` | Port. Default: `5432` |
| `POSTGRES_DB` / `DB_NAME` | Database name |
| `POSTGRES_USER` / `DB_USER` | Database user |
| `POSTGRES_PASSWORD` / `DB_PASSWORD` | Database password |
| `DB_MAX_CONNECTIONS` | Pool maximum size. Default: `20` |
| `DB_IDLE_TIMEOUT_MS` | Idle connection eviction timeout (ms). Default: `30000` |
| `DB_CONN_TIMEOUT_MS` | Connection acquisition timeout (ms). Default: `10000` |
| `DB_QUERY_TIMEOUT` | Query execution timeout (ms). Default: `30000` |

#### Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_ENABLED` | `false` | Enables Redis. When `false`, L1 retrieval and caching are disabled. |
| `REDIS_SENTINEL_ENABLED` | `false` | Activates Sentinel high-availability mode |
| `REDIS_HOST` | `localhost` | Redis server hostname |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD` | (empty) | Redis authentication password |
| `REDIS_DB` | `0` | Redis logical database index |
| `REDIS_MASTER_NAME` | `mymaster` | Sentinel master name |
| `REDIS_SENTINELS` | `localhost:26379,...` | Comma-separated `host:port` Sentinel node list |

#### Caching

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_ENABLED` | Inherits `REDIS_ENABLED` | Enables query result caching |
| `CACHE_DB_TTL` | `300` | Database query cache TTL (seconds) |
| `CACHE_SESSION_TTL` | `SESSION_TTL_MS / 1000` | Session cache TTL (seconds) |

#### AI Services

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (empty) | OpenAI API key for embedding generation. When using Ollama or other compatible local servers, set to any non-empty string (e.g. `ollama`). |
| `EMBEDDING_PROVIDER` | `openai` | Embedding provider: `openai` (default) \| `gemini` \| `ollama` \| `localai` \| `custom`. Model, dimensions, and base URL are automatically set to provider defaults when this is set. |
| `EMBEDDING_API_KEY` | (empty) | Generic embedding API key. Falls back to `OPENAI_API_KEY` or `GEMINI_API_KEY` depending on provider. |
| `EMBEDDING_BASE_URL` | (empty) | Custom OpenAI-compatible endpoint. E.g. `http://localhost:11434/v1` for Ollama. Automatically set for known providers. |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model identifier. Provider default is used when `EMBEDDING_PROVIDER` is set and this is omitted. |
| `EMBEDDING_DIMENSIONS` | `1536` | Embedding dimensionality. Must match `vector(N)` in the schema. Provider default is used when `EMBEDDING_PROVIDER` is set and this is omitted. |
| `EMBEDDING_SUPPORTS_DIMS_PARAM` | (provider default) | Whether to send the `dimensions` parameter to the embedding API. Auto-determined from the provider; override only when using a custom-compatible server with non-standard behavior. |
| `GEMINI_API_KEY` | (empty) | Google Gemini API key. Used when `EMBEDDING_PROVIDER=gemini` and also as fallback for Gemini CLI operations. |

**NLI model:** The NLI classifier (`@huggingface/transformers` + ONNX Runtime) requires no API key. The mDeBERTa model (~280MB ONNX) is downloaded automatically on first use and cached locally. No GPU is required; inference runs on CPU via ONNX Runtime.

**Gemini CLI:** When the `gemini` CLI is installed and available on `$PATH`, it is used in preference to the REST API for all Gemini operations (fragment evaluation, contradiction adjudication, auto-reflect summary generation). Install via `npm install -g @anthropic/gemini-cli` or the platform-specific package manager.

---

## 10.3 Embedding Service Configuration

Embeddings power L3 semantic search and automatic fragment linking. The default provider is OpenAI `text-embedding-3-small`.

Set `EMBEDDING_PROVIDER` to switch providers. Model, dimensions, and base URL are automatically set to provider defaults; override with individual environment variables only when needed. For providers that are not OpenAI-compatible (Cohere, Voyage AI, etc.), replace the `generateEmbedding` function in `lib/tools/embedding.js` directly.

> **Dimension change warning:** Changing `EMBEDDING_DIMENSIONS` requires recreating the PostgreSQL schema and regenerating all embeddings. Run `migration-007` and `backfill-embeddings.js` after the switch (see the Gemini section below for an example).

> **halfvec support:** For models with >2000 dimensions (e.g., Gemini's 3072-dim `gemini-embedding-001`), `migration-007` converts the `embedding` column to `halfvec` type, which supports HNSW indexing up to 4000 dimensions (requires pgvector ≥0.7.0).

See `.env.example` for a configuration template.

---

### Switching Embedding Providers

#### OpenAI (default)

```env
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

| Model | Dimensions | Notes |
|-------|------------|-------|
| text-embedding-3-small | 1536 | Default. Cost-efficient. |
| text-embedding-3-large | 3072 | Higher accuracy. 2× cost. |
| text-embedding-ada-002 | 1536 | Legacy. |

---

#### Google Gemini (`gemini-embedding-001`, 3072 dims)

`text-embedding-004` was discontinued on January 14, 2026. The current recommended model is `gemini-embedding-001` (3072 dimensions).

```env
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=AIza...
```

First-time switch to 3072 dims requires `migration-007` to convert the `embedding` column to `halfvec` type (pgvector ≥0.7.0 required), followed by a full re-embedding pass:

```bash
EMBEDDING_DIMENSIONS=3072 DATABASE_URL=$DATABASE_URL \
  node scripts/migration-007-flexible-embedding-dims.js
DATABASE_URL=$DATABASE_URL node scripts/backfill-embeddings.js
```

| Model | Dimensions | Notes |
|-------|------------|-------|
| gemini-embedding-001 | 3072 | Current recommended model. High precision. |

---

#### Ollama (local, free)

Ollama exposes a `/v1/embeddings` OpenAI-compatible endpoint. No code changes required.

```bash
ollama pull nomic-embed-text
ollama pull mxbai-embed-large
```

```env
OPENAI_API_KEY=ollama
EMBEDDING_BASE_URL=http://localhost:11434/v1
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIMENSIONS=768
```

| Model | Dimensions | Notes |
|-------|------------|-------|
| nomic-embed-text | 768 | 8192-token context, strong MTEB scores |
| mxbai-embed-large | 1024 | 512-token context, competitive MTEB scores |
| all-minilm | 384 | Lightweight, fast inference |

---

#### LocalAI (local, OpenAI-compatible)

```env
OPENAI_API_KEY=localai
EMBEDDING_BASE_URL=http://localhost:8080/v1
EMBEDDING_MODEL=text-embedding-ada-002
EMBEDDING_DIMENSIONS=1536
```

---

#### LM Studio (local, OpenAI-compatible)

Enable the Local Server in LM Studio, load an embedding model, then:

```env
OPENAI_API_KEY=lmstudio
EMBEDDING_BASE_URL=http://localhost:1234/v1
EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5-GGUF
EMBEDDING_DIMENSIONS=768
```

---

#### llama.cpp server (local, OpenAI-compatible)

```bash
./llama-server -m nomic-embed-text-v1.5.Q4_K_M.gguf --embedding --port 8080
```

```env
OPENAI_API_KEY=llamacpp
EMBEDDING_BASE_URL=http://localhost:8080/v1
EMBEDDING_MODEL=nomic-embed-text-v1.5
EMBEDDING_DIMENSIONS=768
```

---

### Proprietary APIs (custom adapter required, code replacement)

Cohere, Voyage AI, Gemini, Mistral, Jina AI, and Nomic either have non-OpenAI-compatible APIs or require specific request structures. Replace the `generateEmbedding` function in `lib/tools/embedding.js` with the snippet for your provider.

#### Cohere

```bash
npm install cohere-ai
```

```js
// lib/tools/embedding.js — replace generateEmbedding
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
|-------|------------|-------|
| embed-v4.0 | 1536 | Latest, multilingual |
| embed-multilingual-v3.0 | 1024 | Legacy multilingual |

---

#### Voyage AI

```js
// lib/tools/embedding.js — replace generateEmbedding
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
|-------|------------|-------|
| voyage-3.5 | 1024 | Highest accuracy |
| voyage-3.5-lite | 512 | Lower cost, faster |
| voyage-code-3 | 1024 | Code-optimized |

---

#### Google Gemini

The existing `GEMINI_API_KEY` environment variable can be reused.

```js
// lib/tools/embedding.js — replace generateEmbedding
export async function generateEmbedding(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`;
  const res  = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      model:   "models/text-embedding-004",
      content: { parts: [{ text }] }
    })
  });
  const data = await res.json();
  return normalizeL2(data.embedding.values);
}
```

```env
GEMINI_API_KEY=...
EMBEDDING_DIMENSIONS=768
```

---

#### Mistral AI

Uses OpenAI SDK — only `baseURL` differs.

```js
// lib/tools/embedding.js — replace generateEmbedding
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

Free tier: 100 RPM / 1M tokens per month.

```js
// lib/tools/embedding.js — replace generateEmbedding
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
|-------|------------|-------|
| jina-embeddings-v3 | 1024 | MRL support (32–1024 flexible) |
| jina-embeddings-v2-base-en | 768 | English-only |

---

#### Nomic

Free tier: 1M tokens per month. Uses OpenAI SDK with a custom `baseURL`.

```js
// lib/tools/embedding.js — replace generateEmbedding
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

| Provider | Dimensions | Configuration | Free Tier |
|----------|------------|---------------|-----------|
| OpenAI text-embedding-3-small | 1536 | Env vars only | No |
| OpenAI text-embedding-3-large | 3072 | Env vars only | No |
| Ollama (nomic-embed-text) | 768 | Env vars only | Free (local) |
| Ollama (mxbai-embed-large) | 1024 | Env vars only | Free (local) |
| LocalAI | Variable | Env vars only | Free (local) |
| LM Studio | Variable | Env vars only | Free (local) |
| llama.cpp | Variable | Env vars only | Free (local) |
| Cohere embed-v4.0 | 1536 | Code replacement | No |
| Voyage AI voyage-3.5 | 1024 | Code replacement | No |
| Google Gemini gemini-embedding-001 | 3072 | Env vars only (`EMBEDDING_PROVIDER=gemini`) | Limited |
| Mistral mistral-embed | 1024 | Code replacement | No |
| Jina jina-embeddings-v3 | 1024 | Code replacement | 1M tokens/mo |
| Nomic nomic-embed-text-v1.5 | 768 | Code replacement | 1M tokens/mo |

---

## 11. Deployment

See **[INSTALL.en.md](INSTALL.en.md)** for full installation, migration, client configuration, and hook setup instructions.

---

## 12. Endpoint Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp` | Streamable HTTP: receive JSON-RPC 2.0 request |
| `GET` | `/mcp` | Streamable HTTP: open SSE stream for server push |
| `DELETE` | `/mcp` | Streamable HTTP: terminate session |
| `GET` | `/sse` | Legacy SSE: create session (`accessKey` query parameter) |
| `POST` | `/message?sessionId=` | Legacy SSE: receive JSON-RPC 2.0 request |
| `GET` | `/health` | Health check: PostgreSQL, Redis, session counts. Redis disabled → 200; DB or Redis (when enabled) down → 503 |
| `GET` | `/metrics` | Prometheus metrics (prom-client) |
| `GET` | `/.well-known/oauth-authorization-server` | OAuth 2.0 authorization server metadata |
| `GET` | `/.well-known/oauth-protected-resource` | OAuth 2.0 protected resource metadata |
| `GET` | `/authorize` | OAuth 2.0 authorization endpoint (PKCE required) |
| `POST` | `/token` | OAuth 2.0 token endpoint (authorization code exchange) |
| `GET` | `/v1/internal/model/nothing` | Admin SPA. Serves static HTML with login form (no authentication). Data API endpoints require master key. |
| `POST` | `/v1/internal/model/nothing/auth` | Master key verification endpoint |
| `GET` | `/v1/internal/model/nothing/stats` | Dashboard statistics (fragment count, API call volume, system metrics) |
| `GET` | `/v1/internal/model/nothing/activity` | Recent fragment activity log (last 10 entries) |
| `GET` | `/v1/internal/model/nothing/keys` | List provisioned API keys |
| `POST` | `/v1/internal/model/nothing/keys` | Create API key. Raw key returned once in response; only hash stored. |
| `PUT` | `/v1/internal/model/nothing/keys/:id` | Update API key status (active ↔ inactive) |
| `DELETE` | `/v1/internal/model/nothing/keys/:id` | Delete API key |

---

## 13. References

Malkov, Y. A., & Yashunin, D. A. (2018). Efficient and robust approximate nearest neighbor search using hierarchical navigable small world graphs. *IEEE Transactions on Pattern Analysis and Machine Intelligence*, 42(4), 824–836.

Aristotle. *De Memoria et Reminiscentia* [On Memory and Recollection]. Translated by J. I. Beare. In *The Works of Aristotle*, Vol. III. Oxford University Press, 1931.

PostgreSQL Global Development Group. (2024). *PostgreSQL 16 Documentation: GIN Indexes*. https://www.postgresql.org/docs/16/gin.html

pgvector. (2024). *Open-source vector similarity search for Postgres*. https://github.com/pgvector/pgvector

Hardt, D., Ed. (2012). *The OAuth 2.0 Authorization Framework*. RFC 6749. IETF.

Sakaguchi, K., Bras, R. L., Bhagavatula, C., & Choi, Y. (2021). WinoGrande: An adversarial winograd schema challenge at scale. *Communications of the ACM*, 64(9), 99–106.

---

*Memento MCP — Fragment-Based Persistent Memory for Language Model Agents*
*Author: Jinho Choi — jinho.von.choi@nerdvana.kr*
