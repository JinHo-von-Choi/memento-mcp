# Internals

## MemoryManager (Orchestration Layer)

In v2.5.2, MemoryManager was reduced from 1,790 lines to 904 lines. In v2.10.0 (Phase 5-B), it was finally decomposed into a 259-line thin facade. Business logic is delegated to 4 processors under `lib/memory/processors/`.

**v2.10.0 decomposition result:**

| Processor | Delegated operations | Lines |
|-----------|---------------------|-------|
| `MemoryRememberer` | `remember()`, `batchRemember()` | ~695 |
| `MemoryRecaller` | `recall()`, `context()` | ~405 |
| `MemoryReflector` | `reflect()` | ~89 |
| `MemoryLinker` | `link()`, `forget()`, `amend()` | ~80 |

**Legacy decomposed modules (independent of facade):**

| Module | Delegated to | Role |
|--------|-------------|------|
| `ContextBuilder` | `context()` | Core/Working/Anchor Memory composition, rankedInjection, context hint generation |
| `ReflectProcessor` | `reflect()` | summary/decisions/errors_resolved/new_procedures/open_questions fragment conversion and storage, episode creation, Working Memory cleanup |
| `BatchRememberProcessor` | `batchRemember()` | Phase A (validation) → Phase B (transactional INSERT) → Phase C (post-processing) 3-stage batch storage |
| `QuotaChecker` | `remember()` entry | Per-API-key fragment quota (fragment_limit) check |
| `RememberPostProcessor` | After `remember()` completes | Embedding generation, morpheme indexing, auto-linking, assertion check, temporal linking, evaluation queue enqueue, ProactiveRecall pipeline. ProactiveRecall logic included -- creates automatic `related_to` links with fragments sharing keyword overlap (>=50%) on remember() |

**Facade constructor flow:** Initializes 20 shared objects → injects into 4 processors via DI → calls `_installSharedSync()`. All 15 public methods are implemented as single-line delegations.

**_installSharedSync:** Wraps each shared property setter on the facade (store, index, factory, etc.) with `Object.defineProperty`. A single assignment like `mm.store = stub` is automatically propagated to the facade and all processors (test DI compatibility).

**Delegation pattern:** Each module receives required dependencies (store, index, factory, bound methods, etc.) through its constructor. MemoryManager binds self-referencing methods in its constructor (`this.recall.bind(this)`, `this.remember.bind(this)`) and passes them, so modules never back-reference MemoryManager.

**reflect resolution_status auto-setting:** ReflectProcessor automatically assigns resolution_status to reflect-generated fragments. `errors_resolved` items receive `resolutionStatus: "resolved"`, and `open_questions` items receive `resolutionStatus: "open"`. All reflect-generated fragments also propagate `sessionId` for session-level tracking.

**remember() pipeline structure (v2.11.0):**

```
remember(params)
  ├── [NEW v2.11.0] dryRun branch — early return before atomic guard declaration
  │     params.dryRun === true → computes validationResult without storing
  │     returns { dryRun: true, wouldStore: true/false, reason, params }
  ├── atomic guard — atomicRemember && keyId condition
  ├── QuotaChecker.check() — conditional on !(atomicRemember && keyId)
  ├── [NEW v2.11.0] idempotency branch — when params.idempotencyKey is present
  │     FragmentReader.findByIdempotencyKey(key, keyId) lookup
  │     if existing fragment found → early return { id, idempotent: true }
  ├── FragmentWriter.insert() — actual fragment storage
  │     idempotency_key column stores params.idempotencyKey (nullable)
  └── RememberPostProcessor.run() — embedding/morpheme/link/eval post-processing
```

The `dryRun` branch is positioned before the atomic guard declaration (before `fragment` variable TDZ). The R12 hotfix (v2.10.1) moved the atomic branch to after the `fragment` declaration, resolving the TDZ. The v2.11.0 dryRun branch follows the same placement.

**recall() pipeline — fields pick position:**

```
recall(query)
  ├── L1 Redis in-memory cache (warm path)
  ├── L2 pgvector embedding similarity
  ├── L2.5 graph neighbors (fragment_links 1-hop)
  ├── L3 PostgreSQL full-text search (morpheme)
  ├── L4 Cross-Encoder Reranker (top 30 from RRF)
  ├── RRF merge (k=60)
  ├── token budget truncation (tokenBudget)
  ├── valid_to filter
  ├── Phase 2 explanations (ExplanationBuilder.annotate)
  ├── Phase 5 CBR filter (cbrEligibility.filter, when sq.caseId present)
  ├── trimmed.map(({ _rrfScore, ...rest }) => rest)  — strip internal scores
  ├── [NEW v2.11.0] pickFields(query.fields)  — sparse fieldset
  │     when query.fields is not specified, all fields returned (backward compat)
  │     L1/L2/RRF cache stages retain full fields; pick is applied only at final return
  └── SearchEventRecorder.record() — event recording
```

`pickFields` removes fields outside the 17-item whitelist (`id, content, type, importance, topic, ...`). It is not applied to cache stages (L1 warm hits, RRF intermediate objects) to preserve cache efficiency.

---

## MemoryEvaluator

When the server starts, the MemoryEvaluator worker runs in the background. It is a singleton started via `getMemoryEvaluator().start()`. On SIGTERM/SIGINT, it stops as part of the graceful shutdown flow.

The worker polls the Redis queue `memory_evaluation` every 5 seconds. It waits when the queue is empty. When a job is dequeued, it calls Gemini CLI (`geminiCLIJson`) to evaluate the fragment content's soundness. Evaluation results are used to update the utility_score and verified_at in the fragments table.

New fragments are enqueued for evaluation when stored via remember. However, fact, procedure, and error types are excluded. Only decision, preference, and relation types are evaluated. Evaluation is decoupled from storage, so it does not affect remember call response time.

In environments where Gemini CLI is not installed, the worker starts but skips evaluation tasks.

---

## MemoryConsolidator

Fragment storage flow: When `remember()` is called, ConflictResolver's `autoLinkOnRemember` immediately creates `related` links with fragments sharing the same topic. When the `embedding_ready` event fires, GraphLinker adds semantic similarity-based links. MemoryConsolidator is a separate periodic pipeline that maintains this link network.

An 18-step maintenance pipeline that runs when the memory_consolidate tool is invoked or the internal scheduler triggers (every 6 hours, adjustable via CONSOLIDATE_INTERVAL_MS).

- **TTL tier transitions**: hot -> warm -> cold demotion based on access frequency and elapsed time. warm -> permanent promotion only targets fragments with importance>=0.8 and `quality_verified IS DISTINCT FROM FALSE` -- a Circuit Breaker pattern that blocks permanent tier entry for fragments explicitly judged negative (FALSE) (TRUE=normal, NULL+is_anchor=anchor fallback, NULL+importance>=0.9=offline fallback). Permanent-tier fragments with is_anchor=false + importance<0.5 + 180 days without access are demoted to cold (parole)
- **Importance decay**: Batch-processed via a single PostgreSQL `POWER()` SQL. Formula: `importance * 2^(-dt / halfLife)`. dt is computed from `COALESCE(last_decay_at, accessed_at, created_at)`. After application, `last_decay_at = NOW()` is set (idempotency). Per-type half-lives -- procedure:30d, fact:60d, decision:90d, error:45d, preference:120d, relation:90d, others:60d. `is_anchor=true` excluded, minimum 0.05 guaranteed
- **Expired fragment deletion (multi-dimensional GC)**: Judged by 5 composite conditions. (a) utility_score < 0.15 + 60 days inactive, (b) isolated fact/decision fragments (0 access, 0 links, 30+ days, importance < 0.2), (c) legacy compatibility condition (importance < 0.1, 90 days), (d) resolved error fragments (`[resolved]` prefix + 30+ days + importance < 0.3), (e) NULL type fragments (gracePeriod elapsed + importance < 0.2). Fragments within the 7-day gracePeriod are protected. Max 50 deletions per cycle. `is_anchor=true` and `permanent` tier excluded
- **Duplicate merging**: Fragments with identical content_hash are merged into the most important one. Links and access stats are consolidated
- **Missing embedding backfill**: Triggers async embedding generation for fragments with NULL embedding
- **Retroactive auto-linking (5.5)**: GraphLinker.retroLink() processes up to 20 orphan fragments that have embeddings but no links, automatically creating relationships
- **utility_score recalculation**: Updated via `importance * (1 + ln(max(access_count, 1))) / age_months^0.3`. Dividing by the 0.3 power of age (months) gradually lowers older fragments' scores (1 month / 1.00, 12 months / 2.29, 24 months / 2.88). Then registers fragments with ema_activation>0.3 AND importance<0.4 for MemoryEvaluator re-evaluation
- **Auto anchor promotion**: Promotes fragments with access_count >= 10 + importance >= 0.8 to `is_anchor=true`
- **Incremental contradiction detection (3-stage hybrid)**: For new fragments since the last check, extracts pairs with pgvector cosine similarity > 0.85 against existing fragments in the same topic (Stage 1). NLI classifier (mDeBERTa ONNX) determines entailment/contradiction/neutral (Stage 2) -- high-confidence contradictions (conf >= 0.8) are resolved immediately without Gemini, clear entailments pass through immediately. Only NLI-uncertain cases (numerical/domain contradictions) escalate to Gemini CLI (Stage 3). On confirmation, `contradicts` link + temporal logic resolution (older fragment importance reduced + `superseded_by` link). Resolution results are automatically recorded as `decision` type fragments (audit trail) -- trackable via `recall(keywords=["contradiction","resolved"])`. When CLI is unavailable, pairs with similarity > 0.92 are queued in a Redis pending queue
- **Pending contradiction post-processing**: When Gemini CLI becomes available, up to 10 items are dequeued for re-evaluation
- **Feedback report generation**: Aggregates tool_feedback/task_feedback data to produce per-tool usefulness reports
- **Feedback-adaptive importance correction (10.5)**: Combines the last 24 hours of tool_feedback data with session recall history to incrementally adjust importance. `sufficient=true`: +5%, `sufficient=false`: -2.5%, `relevant=false`: -5%. Criteria: fragments matching session_id, max 20/session, lr=0.05, clipped to [0.05, 1.0]. is_anchor=true fragments excluded
- **Redis index cleanup + stale fragment collection**: Removes orphaned keyword indexes and returns a list of fragments past their verification cycle
- **session_reflect noise cleanup**: Among topic='session_reflect' fragments, preserves only the latest 5 per type and deletes the rest with 30+ days age + importance < 0.3 (max 30 per cycle)
- **Supersession batch detection**: For fragment pairs with the same topic + type and embedding similarity in the 0.7~0.85 range, Gemini CLI determines if a supersession relationship exists. On confirmation, superseded_by link + valid_to set + importance halved. Operates complementarily to GraphLinker's >= 0.85 range
- **Decay application (EMA dynamic half-life)**: Applies exponential decay to all fragments via PostgreSQL `POWER()` batch SQL. Fragments with high `ema_activation` get their half-life extended up to 2x (`computeDynamicHalfLife`). Formula: `importance * 2^(-dt / (halfLife * clamp(1 + ema * 0.5, 1, 2)))`
- **EMA batch decay**: Periodically reduces ema_activation of long-unaccessed fragments. 60+ days unaccessed -> ema_activation=0 (reset), 30-60 days unaccessed -> ema_activation*0.5 (halved). is_anchor=true fragments excluded. Prevents long-idle fragments from retaining past boost values despite no search exposure

### compressOldFragments (KNN Batch Parallelization)

`ConsolidatorGC.compressOldFragments()` groups long-unaccessed, low-importance fragments by topic, then forms similarity groups via KNN (cosine >= 0.80) and compresses them into representative fragments. In v2.5.2, the KNN neighbor lookup was converted from sequential N+1 queries to `BATCH_SIZE=20` unit `Promise.all` parallelism. Within each batch, pgvector KNN queries for each fragment execute concurrently, significantly reducing processing time compared to linear execution as the number of target fragments grows. Individual query failures are isolated via `.catch(() => ({ rows: [] }))` so they do not block the entire batch.

---

## Session and Authentication Internals

### forget/amend/link Error Unification Pattern

The forget, amend, link, and fragment_history operations first look up the fragment via `store.getById(id, agentId, keyId, groupKeyIds)`. The SQL query includes a `key_id` condition, so other tenants' fragments are filtered out at the SELECT stage. When the result is null, the same error message is returned regardless of whether the fragment actually exists.

| Operation | Error message |
|-----------|--------------|
| `forget(id=...)` | `"Fragment not found or no permission"` |
| `amend(id=...)` | `"Fragment not found or no permission"` |
| `link(fromId=..., toId=...)` | `"One or both fragments not found or no permission"` |
| `fragment_history(id=...)` | `"Fragment not found or no permission"` |

This pattern prevents existence oracle vulnerabilities. Even if an attacker guesses another tenant's fragment ID, they cannot distinguish between "not found" and "no permission".

### injectSessionContext Helper

Exported from `lib/handlers/mcp-handler.js` and also imported for reuse in the SSE handler (`sse-handler.js`).

```js
injectSessionContext(msg, { sessionId, sessionKeyId, sessionGroupKeyIds,
                             sessionPermissions, sessionDefaultWorkspace });
```

Only operates on the `tools/call` method. First deletes client-sent `_keyId`, `_groupKeyIds`, `_sessionId`, `_permissions`, `_defaultWorkspace` fields, then re-injects them with the server's authentication result. This completely blocks any path for clients to forge session context.

### AdminEsmLoadError Sentinel Pattern

`tests/unit/admin-test-helper.js`'s `loadAdmin()` loads `assets/admin/admin.js` via Node.js `vm.runInContext`. After admin.js was converted to an ESM entry point (with import/export statements) in v2.5.7, the vm sandbox throws a SyntaxError because it does not support ESM syntax.

To handle this explicitly, `AdminEsmLoadError` is thrown when an ESM file is detected. Test files catch this error and switch to `describe.skip`. The guard distinguishing real errors from the sentinel:

```js
} catch (e) {
  if (!(e instanceof AdminEsmLoadError)) throw e;
}
const _describe = _adminLoaded ? describe : describe.skip;
```

Admin module tests are planned to migrate to directly importing `assets/admin/modules/*` in the future.

### updateTtlTier key_id Isolation

`FragmentWriter.updateTtlTier` accepts a `keyId` parameter and appends a `key_id` condition to the UPDATE query. This blocks cross-key access where a different API key could modify the TTL tier of fragments it does not own. When keyId is null, only master-key-owned fragments (`key_id IS NULL`) are targeted.

### Workspace Filter Propagation

`FragmentSearch._buildSearchQuery()` normalizes the `workspace` value into `sq.workspace`. `_executeSearch()` passes it to L2 (keyword/topic) search options and as the 8th argument to L3 `searchBySemantic`.

All six `FragmentReader` methods — `searchByKeywords`, `searchByTopic`, `searchBySemantic`, `searchByTimeRange`, `searchAsOf`, and `searchBySource` — support the `(workspace = $N OR workspace IS NULL)` condition. `_searchTemporal` also passes `workspace: sq.workspace` to `searchByTimeRange`.

`MemoryManager` workspace resolution priority: `params.workspace ?? params._defaultWorkspace ?? null`. `_defaultWorkspace` is read from `api_keys.default_workspace` at auth time, stored in the session, and injected as `args._defaultWorkspace` on each tool call.

### Session Auto-Recovery

When a "Session not found" or "Session expired" error occurs in the session store, the server immediately runs a re-authentication flow. During re-authentication, the original session's `keyId` and `groupKeyIds` are restored and injected into the new session. The reconnection is transparent to the client; the re-authentication event is recorded in the audit log.

Legacy SSE sessions also apply a sliding window: `expiresAt` is refreshed to `now + SESSION_TTL_MS` on every validated request.

### Redis TTL Sync

`validateStreamableSession` uses the actual remaining TTL read from Redis instead of a fixed `CACHE_SESSION_TTL` when refreshing a session. As a session approaches expiration, its remaining lifetime is preserved accurately after each refresh.

### SSE Disconnect

When an SSE stream closes (`res.on('close')`), the server removes only the SSE response object; the session itself is kept alive. The session persists until its Redis TTL expires, allowing a reconnecting client to resume the same session.

### OAuth refresh_token is_api_key Propagation

When refreshing a token via `POST /token` with `grant_type=refresh_token`, the `is_api_key` flag from the original token is propagated to the newly issued access_token and refresh_token. API key-based clients retain the same isolation context after a refresh.

### SESSION_TTL Default Change

The default value of the `SESSION_TTL` environment variable changed from 240 to 43200 minutes (30 days). Sessions use a sliding window — the TTL is extended on every tool use, so sessions expire only after 30 days of inactivity. Actively used sessions effectively never expire.

---

## EmbeddingCache (Query Embedding Cache)

Caches query text embedding vectors in Redis within `FragmentSearch._searchL3()` to reduce latency on repeated searches.

**Key pattern:** `emb:q:{first 16 chars of SHA-256}`. Identical query text always maps to the same key.

**Value format:** `Float32Array` is binary-serialized to `Buffer` for storage. On retrieval, it is deserialized back to `number[]`.

**TTL:** Default 3600 seconds (1 hour). Adjustable via the constructor's `ttlSeconds` option.

**Fault isolation:** All Redis calls are wrapped in try-catch, returning null/ignored on failure. Cache failures do not block the search flow. When Redis is not configured (status === "stub"), it always operates as a cache miss.

---

## Reranker (Cross-Encoder Reranking)

After RRF merging, the top 30 candidates are reranked by a cross-encoder for higher precision. `preloadReranker()` is called asynchronously at server startup to prepare the model before the first recall request.

**Dual mode:**
- `RERANKER_URL` set: external HTTP service (`POST /rerank { query, documents[] } → { scores[] }`)
- Not set: `@huggingface/transformers` + ONNX in-process

**In-Process Model Selection (`RERANKER_MODEL`):**

| Value | Model | Size | Language | Recommended for |
|-------|-------|------|----------|-----------------|
| `minilm` (default) | Xenova/ms-marco-MiniLM-L-6-v2 | ~80MB | English only | English users |
| `bge-m3` | onnx-community/bge-reranker-v2-m3-ONNX | ~280MB (q4) | 100+ languages (incl. Korean) | Non-English users |

> **Non-English users are strongly recommended to use `RERANKER_MODEL=bge-m3`.** ms-marco-MiniLM-L-6-v2 was fine-tuned exclusively on the English MS MARCO dataset and cannot reliably rank non-English query-document pairs. bge-m3 operates via the same ONNX in-process mechanism and downloads automatically from HuggingFace Hub on first run.

**Automatic external-to-inprocess fallback:** After 3 consecutive failures, switches to in-process mode permanently until server restart. In either mode, if scores cannot be retrieved, the original RRF result is returned unchanged (graceful degradation).

**Final score:** `sigmoid(logit) * recency_boost`. recency_boost uses 365-day linear decay in the [0.9, 1.1] range.

---

## TemporalLinker (Time-Based Auto-Linking)

Runs asynchronously in the `MemoryManager._autoLinkOnRemember()` chain on every `remember()` call. Creates `temporal` links between the new fragment and existing fragments within ±24h that share the same `topic` (up to 5 links).

**Weight formula:** `max(0.3, 1.0 - hours/24)` — 0h=1.0, 12h=0.5, 24h=0.3.

**API key isolation:** `options.keyId` is forwarded as `key_id = ANY($n)` in the SQL query so that fragments owned by other API keys are never linked.

`fragment_links.weight` was changed from integer to real in migration-023 to support float weights.

---

## CaseEventStore

A dedicated store that records and queries semantic milestones in the case_events table. Injected into `MemoryManager` and used through the `reconstructHistory()` path.

**Key methods:**

| Method | Description |
|--------|-------------|
| `append(caseId, sessionId, eventType, summary, keyId)` | Records a new event. Uses `FOR UPDATE` lock on sequence_no for concurrency control |
| `addEdge(fromId, toId, edgeType, confidence)` | Adds a DAG edge between events |
| `addEvidence(fragmentId, eventId, kind)` | Records a fragment-event evidence join |
| `getByCase(caseId, opts)` | Queries event list scoped to a case (occurred_at ascending) |
| `getBySession(sessionId, opts)` | Queries event list scoped to a session |
| `getEdgesByEvents(eventIds)` | Batch queries all edges for a list of event IDs |

**8 event_types:**

- `milestone_reached` — Goal milestone reached
- `hypothesis_proposed` — Hypothesis proposed
- `hypothesis_rejected` — Hypothesis rejected
- `decision_committed` — Decision committed
- `error_observed` — Error observed
- `fix_attempted` — Fix attempted
- `verification_passed` — Verification passed
- `verification_failed` — Verification failed

**Concurrency:** Inside `append()`, an exclusive row lock is acquired via `SELECT sequence_no FROM case_events WHERE case_id = $1 FOR UPDATE` before performing the INSERT. This prevents sequence_no duplication when events are concurrently inserted into the same case.

---

## HistoryReconstructor

Collects fragments and events based on `case_id` or `entity` keywords and reconstructs a chronological narrative. Called from `MemoryManager.reconstructHistory()`.

**`reconstruct(params)` return structure:**

| Field | Description |
|-------|-------------|
| `ordered_timeline` | Fragment list (created_at ascending) |
| `causal_chains` | Causal chain array projected via BFS |
| `unresolved_branches` | List of unresolved branches |
| `supporting_fragments` | Evidence fragments for causal chains |
| `case_events` | Event list for the given case/session |
| `event_dag` | case_event_edges DAG representation |
| `summary` | Narrative summary text |

**BFS causal chain algorithm:**

Constructs a unified graph from `caused_by` / `resolved_by` edges in `fragment_links` and edges of the same types in `case_event_edges`. Performs BFS from start nodes to extract all reachable causal chains. Cycles are blocked via a visited set.

**Unresolved branch detection:**

Collected via OR of these two conditions:
- Fragments with `fragments.resolution_status = 'open'`
- Events with `case_events.event_type = 'error_observed'` that have no outgoing `resolved_by` edge

---

## ReconsolidationEngine (Dynamic Link Updates)

`lib/memory/ReconsolidationEngine.js` dynamically updates the weight and confidence of fragment_links and records change history in the link_reconsolidations table.

**reconsolidate(linkId, action, opts) — 5 actions:**

| action | weight delta | confidence delta | additional effect |
|--------|-------------|-----------------|------------------|
| reinforce | +0.2 | +0.05 | |
| decay | -0.15 | -0.1 | |
| quarantine | -0.3 | -0.1 | quarantine_state = 'soft' |
| restore | +0.3 | +0.05 | quarantine_state = 'released' |
| soft_delete | 0 | 0 | deleted_at = NOW() |

Weight is clamped to [0, 2]; confidence is clamped to [0, 1].

**Rate-limit:** decay/quarantine actions on the same link_id are blocked for 60 seconds (in-memory Map, lastDecayAt).

**quarantineAdjacentLinks(fromId, toId, keyId):** Called by ConflictResolver on contradicts detection. Soft-quarantines all related/temporal links between the two conflicting fragments.

**ENABLE_RECONSOLIDATION env var:** Must be set to `true` to activate (default: false). When disabled, neither tool_feedback nor ConflictResolver calls reconsolidate.

---

## EpisodeContinuityService (Episode Continuity)

`lib/memory/EpisodeContinuityService.js` inserts a case_events milestone on reflect() calls and connects it to the previous episode via a preceded_by edge.

**linkEpisodeMilestone(episodeFragmentId, agentId, keyId, sessionId):**

1. Queries the first 200 characters of the fragment as summary
2. Inserts a milestone_reached event into case_events (ON CONFLICT idempotency_key DO NOTHING — deduplication)
3. If the in-memory cache holds the previous milestone eventId for the same agentId, inserts a preceded_by edge
4. Stores the current eventId in the lastEventByAgent Map

**idempotency_key format:** `milestone:{agentId}:{sessionId}:{fragmentId}` — prevents duplicate events on server restart.

Called fire-and-forget after MemoryManager.reflect() completes. Failures do not affect the reflect result.

---

## SpreadingActivation (Spreading Activation)

`lib/memory/SpreadingActivation.js` proactively activates relevant fragments from the current conversation context (contextText). Based on the ACT-R Spreading Activation model.

**activateByContext(contextText, agentId, keyId, sessionId):**

1. Extracts up to 8 keywords from contextText via FragmentFactory.extractKeywords()
2. Queries seed fragments (up to 10) via keywords GIN index (valid_to IS NULL, key_id isolation applied)
3. Runs 1-hop graph spread via fetchGraphNeighbors() (up to 10 fragments)
4. Queues activated fragment IDs in activationQueue → drainQueue() updates activation_score +0.1, accessed_at/access_count

**Cache:** 10-minute TTL keyed by `{agentId}:{keyId}:{sessionId}`. Prevents duplicate activation of already-activated fragments within the same session.

Called fire-and-forget from MemoryManager.recall(). Only active when `ENABLE_SPREADING_ACTIVATION=true` (default: false).

---

## Contradiction Detection Pipeline

A 3-stage hybrid architecture that suppresses O(N^2) LLM comparison costs while maintaining precision.

```
On new fragment storage
       |
pgvector cosine similarity > 0.85 candidate filter
       |
mDeBERTa NLI (in-process ONNX / external HTTP service)
  +-- contradiction >= 0.8  -> Immediate resolution (superseded_by link + valid_to update)
  +-- entailment   >= 0.6   -> Confirmed unrelated (no link created)
  +-- Other (ambiguous)     -> Gemini CLI escalation
       |
Temporal axis (valid_from/valid_to, superseded_by) preserves existing data
```

- **Cost efficiency**: 99% of candidates handled by NLI; LLM calls occur only for numerical/domain contradictions
- **Zero data loss**: Temporal columns manage versioning instead of deleting fragments
- **Implementation files**: `lib/memory/NLIClassifier.js`, `lib/memory/MemoryConsolidator.js`
- **Environment variable**: When `NLI_SERVICE_URL` is unset, ONNX in-process is used automatically (~280MB, downloaded on first run)

---

## Smart Recall (v2.5.6)

Three auto-learning subsystems were added to the remember/recall pipeline.

### ProactiveRecall (RememberPostProcessor)

The final stage of the remember() post-processing pipeline. Performs L1/L3 search using the stored fragment's keywords, and creates `related_to` links when keyword overlap with existing fragments >= 0.5.

- Search: `FragmentSearch.search({ keywords, tokenBudget: 400, fragmentCount: 5 })`
- Link criteria: `|shared_keywords| / max(|new_kw|, |candidate_kw|) >= 0.5`
- Fire-and-forget: tracked via `_proactiveRecallPromise` (for test stability)
- No embedding used: embeddings have not yet been generated at remember() time, so only the keyword path is used

### CaseRewardBackprop (CaseEventStore -> CaseRewardBackprop)

When a verification event is added to case_events, atomically adjusts the importance of evidence fragments (via fragment_evidence JOIN) for that case.

- SQL: `UPDATE fragments SET importance = LEAST(1.0, GREATEST(0.0, importance + $delta)) FROM fragment_evidence, case_events WHERE ...`
- Concurrency: UPDATE FROM is atomic via row locking. No read-modify-write race condition.
- Trigger: fire-and-forget after `CaseEventStore.append()` COMMIT
- Singleton: `getBackprop()` (shared for server lifetime)

### SearchParamAdaptor (FragmentSearch -> SearchParamAdaptor)

Records result counts for each search call in the `search_param_thresholds` table and atomically adjusts minSimilarity via a DB-level CASE expression.

- Table: `agent_memory.search_param_thresholds` (migration-029)
- Key: `(key_id, query_type, hour_bucket)` — key_id=-1 for master/global default
- Learning: applied after `sample_count >= 50`
- Adaptation: `avg_result < 1 -> -0.01`, `avg_result > 8 -> +0.01` (symmetric, [0.10, 0.60])
- UPSERT: single INSERT...ON CONFLICT DO UPDATE without SELECT (TOCTOU-free)
- Integration: Promise attached in `_buildSearchQuery()`, awaited in `_searchL3()`

---

## Symbolic Memory Layer Internals (v2.8.0)

The Symbolic Memory Layer section in architecture.md covers the overall design. This chapter focuses on implementation details of each module.

### SymbolicOrchestrator

`lib/symbolic/SymbolicOrchestrator.js`. Constructor: `({ config, metrics, rulePackLoader })`. All three dependencies provide production singleton defaults and are replaceable in tests via a DI structure. The `evaluate({ mode, candidates, ctx, timeoutMs, ruleVersion, correlationId })` entry point handles 5 modes (`recall|remember|link|explain|shadow`).

When `config.enabled=false`, it immediately returns a noop result with zero CPU cost. Timeout is implemented via `Promise.race([evalPromise, timeoutPromise])`; on expiry it returns `degraded=true` and never throws. `clearTimeout` handling prevents timer leaks. `rule_version` and `correlation_id` accompany every evaluate call and are reflected in the result object as `ruleVersion`.

### SymbolicMetrics

`lib/symbolic/SymbolicMetrics.js`. Registers 4 prom-client metrics immediately on module load:
- `memento_symbolic_claim_extracted_total` (labels: extractor, polarity)
- `memento_symbolic_warning_total` (labels: rule, severity)
- `memento_symbolic_gate_blocked_total` (labels: phase, reason)
- `memento_symbolic_op_latency_ms` histogram (labels: op, buckets: 1~500ms)

Four helper methods unify external calls: `recordClaim(extractor, polarity)`, `recordWarning(rule, severity)`, `recordGateBlock(phase, reason)`, `observeLatency(op, ms)`. Supports both singleton `symbolicMetrics` export and DI injection simultaneously.

### ClaimExtractor

`lib/symbolic/ClaimExtractor.js`. Calls `MorphemeIndex.tokenize` asynchronously and falls back to whitespace splitting on failure. Polarity determination priority is `uncertain > negative > positive`; when a negative marker is present, positive markers co-existing are still resolved as negative. The original text and a whitespace-removed version are both checked simultaneously to absorb whitespace variations. Rule-based extractor confidence range is 0.5~0.8; the uncertain interval is 0.4~0.5.

### ClaimStore

`lib/symbolic/ClaimStore.js`. Uses `TEXT key_id` and applies `key_id IS NOT DISTINCT FROM $N` pattern for tenant isolation in all queries. This operator treats NULL=NULL as true, handling master (NULL) and tenant (TEXT) in a single branch without divergence. The `(key_id IS NULL OR key_id = $N)` pattern prohibited since v2.5.7 is not used.

At the `insert` entry point, a `fragment.key_id !== ctx.keyId` mismatch is checked and a `TENANT_ISOLATION_VIOLATION` exception is thrown. `findPolarityConflicts` queries positive↔negative pairs on the same (subject, predicate, COALESCE(object,'')) tuple based on a confidence threshold. Two partial unique indexes replicated in migration-032 (one for master NULL, one for tenant TEXT) block cross-tenant leakage through the ON CONFLICT path.

### ClaimConflictDetector

`lib/symbolic/ClaimConflictDetector.js`. Delegates SQL logic to `ClaimStore.findPolarityConflicts` and is solely responsible for severity calculation, metrics recording, and result normalization (single responsibility). Severity determination: 1 conflict → `low`, 2~3 → `medium`, 4 or more → `high`. ClaimStore exceptions are absorbed here, returning `degraded=true` to avoid blocking the neural path fallback. DI: `({ claimStore, metrics })`.

### LinkIntegrityChecker

`lib/symbolic/LinkIntegrityChecker.js`. Reuses the `sessionLinker.wouldCreateCycle(fromId, toId, agentId, keyId)` 4-arg signature. Adding this signature in Phase 0.5 allowed Phase 3 implementation to reuse existing code. `DIRECTIONAL_RELATIONS = {caused_by, resolved_by, superseded_by, preceded_by}` — types outside this set early-return, avoiding unnecessary cycle checks for undirected links. Advisory only: `hasCycle=true` does not block. DI: `({ sessionLinker })`.

### ExplanationBuilder

`lib/symbolic/ExplanationBuilder.js`. The `annotate(fragments, searchContext)` entry point returns an immutable copy (`{ ...fragment, explanations: reasons }`) via `fragments.map`. The original fragment object (Hot Cache, shared reference with FragmentStore) is never mutated. `reasonBuilder` is replaceable via DI; the default is `buildReasonCodes` from `rules/v1/explain.js`. Empty input returns no-op to minimize GC load. The singleton `explanationBuilder` export is shared with `FragmentSearch`.

### PolicyRules

`lib/symbolic/PolicyRules.js`. Implements 5 predicates as pure synchronous functions:
1. `decisionHasRationale`: for decision type, `linked_to >= 2` or `RATIONALE_REGEX` match
2. `errorHasResolutionPath`: for error type, `CAUSE_FIX_REGEX` match or `resolution_status` present
3. `procedureHasStepMarkers`: for procedure type, `STEP_MARKER_REGEX` match
4. `caseIdHasResolutionStatus`: fragment with case_id that is missing `resolution_status`
5. `assertionNotContradictory`: `assertion_status` simultaneously verified and rejected

`check(fragment)` returns: `[{ rule, severity, detail, ruleVersion }]`. No DB queries; pure JS synchronous.

### CbrEligibility

`lib/symbolic/CbrEligibility.js`. Applies 4 constraints decidable synchronously from in-memory fragment fields without asynchronous DB queries: `tenant_match`, `has_case_id`, `not_quarantine` (quarantine_state !== 'soft'), `resolved_state` (resolution_status is `resolved` or null/undefined). For each blocked fragment, calls `symbolicMetrics.recordGateBlock('cbr', reason)`. DI: `({ metrics })`.

### 5 Rule Files (lib/symbolic/rules/v1/)

**explain.js**: `buildReasonCodes(fragment, searchContext)` function. Input: fragment (including searchPath, layerLatency metadata) + searchContext. Output: array of up to 3 reason codes. L3 morpheme path → `direct_keyword_match`, pgvector L2 → `semantic_similarity`, graph 1-hop → `graph_neighbor_1hop`, timeRange match → `temporal_proximity`, case cohort → `case_cohort_member`, EMA activation (`>= 0.5`) → `recent_activity_ema`.

**link-integrity.js**: `checkCycle(input, ctx)` rule function. Creates a `LinkIntegrityChecker` instance and calls it with `sessionLinker` injected from ctx. Types outside DIRECTIONAL_RELATIONS return `{ hasCycle: false, reason: 'non_directional' }` early.

**claim-conflict.js**: `detectPolarityConflict({ fragmentId, keyId }, { detector })`. Test isolation via `ClaimConflictDetector` DI injection. Detects polarity conflicts for the input fragmentId and returns results including severity.

**policy.js**: `evaluatePolicy(fragment, _ctx)`. Creates a `PolicyRules` singleton instance at module load time. `_ctx` is currently unused and is preserved for future signature compatibility.

**proactive-gate.js**: `evaluateProactiveGate({ source, target, keyId }, _ctx)`. Checks in cost-ascending order: `invalid_target` → `quarantine` → `cohort_mismatch` → `polarity_conflict`. `ClaimConflictDetector` throws are fail-open (returns allowed=true). Returns: `{ allowed, reason, ruleVersion }`.

### RememberPostProcessor 8-Stage Pipeline and _extractSymbolicClaims Invocation Path

The `run()` method in `lib/memory/RememberPostProcessor.js` executes 8 stages sequentially. Stage 8 is Symbolic claim extraction (Phase 1), proceeding as `this._symbolicClaimPromise = this._extractSymbolicClaims(...).catch(...)` fire-and-forget. It does not block the main pipeline; failures do not affect memory storage.

`_extractSymbolicClaims(fragment, { agentId, keyId })`: `SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.claimExtraction` guard → `ClaimExtractor.extract` → `ClaimStore.insert`. TENANT_ISOLATION_VIOLATION exceptions call `symbolicMetrics.recordGateBlock("claim_extraction", "tenant_violation")` and are then swallowed. On successful claim, `symbolicMetrics.recordClaim(extractor, polarity)` is called.

### FragmentSearch Hook Chain Insertion Points

Three hooks execute in order after line 88 in `lib/memory/FragmentSearch.js`:
1. **shadow hook** (line 99): `SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.shadow` → records `symbolicMetrics.observeLatency("shadow_recall", ...)` only
2. **explain hook** (line 107): `SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.explain` → `explanationBuilder.annotate(clean, { searchPath, layerLatency, query, caseContext })`
3. **cbr filter** (line 124): `SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.cbrFilter && sq.caseId` → `cbrEligibility.filter(clean, sq)`. Pre-filter `rawResultCount` is preserved separately to protect the SearchParamAdaptor learning signal.

### ConflictResolver.checkAssertionConsistency and validationWarnings Addition

`checkAssertionConsistency` in `lib/memory/ConflictResolver.js` preserves the existing Jaccard pipeline (`JACCARD_THRESHOLD=0.3`, up to 10 fragments within a 7-day window) while adding Phase 3 symbolic polarity conflict results alongside it. Within the `SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.polarityConflict` guard, `ClaimConflictDetector.detectPolarityConflicts` is called; exceptions are logged with logWarn and swallowed. `conflictWith` IDs found in polarity conflicts are merged into the existing `supersedeCandidates`. The return type is extended to a 3-tuple `{ assertionStatus, supersedeCandidates, validationWarnings }`, returning `validationWarnings: []` as an empty array when the flag is off.

---

## Mode System Internals (v2.9.0)

### ModeRegistry Initialization

On server startup, `initModeRegistry()` reads all `lib/memory/modes/*.json` files and populates an in-memory Map. Four presets are shipped by default.

| Preset | Blocked Tools | Use Case |
|--------|-------------|---------|
| `recall-only` | remember, batch_remember, amend, forget, link, reflect, memory_consolidate | Read-only clients |
| `write-only` | recall, context, graph_explore, fragment_history | Write-only pipelines |
| `onboarding` | memory_consolidate, forget, amend | New user protection |
| `audit` | remember, batch_remember, amend, forget, link, reflect (requiresMaster=true) | Master-key audit sessions |

Each JSON file schema: `{ name, description, excluded_tools[], fixed_tools[], skill_guide_override?, requiresMaster? }`.

### Session Mode Resolution Priority

`_resolveMode(req, msg, dbDefaultMode, keyId)` determines the mode in this order:

1. `X-Memento-Mode` request header (highest priority) — applied if the value is a registered preset name, otherwise null
2. `params.mode` field in an `initialize` request
3. `api_keys.default_mode` DB column (migration-034)

The resolved mode is stored in the session object and reused for all subsequent requests within the same session.

### tools/list Filtering

`filterTools(tools, presetName, isMaster)` removes tools in the `excluded_tools` set and returns the filtered list. Presets with `requiresMaster=true` are only applied to master-key sessions (`keyId === null`); regular API key sessions ignore such presets and receive the full tool list.

When assembling the `get_skill_guide` response, `getSkillGuideOverride(presetName, isMaster)` returns the `skill_guide_override` string from the preset. If present, this overrides the default skill guide text.

---

## RecallSuggestionEngine Internals (v2.9.0)

`lib/memory/RecallSuggestionEngine.js`. Called after `MemoryManager.recall()` completes in a fail-open manner. On exception, returns null so the recall response itself is unaffected.

The engine injects a `_suggestion` field into the recall response as a non-invasive hint. Four rules are evaluated in priority order; the first match returns immediately (no duplicate suggestions).

| Rule Code | Detection Condition | Recommended Tool |
|-----------|-------------------|-----------------|
| `repeat_query` | Same keyword query type ≥3 times within 5 minutes | reconstruct_history or graph_explore |
| `empty_result_no_context` | 0 results + no contextText | recall (add contextText) |
| `large_limit_no_budget` | limit ≥ 50 + no tokenBudget | recall (add tokenBudget) |
| `no_type_filter_noisy` | no type filter + total fragments > 100 | recall (add type filter) |

The `repeat_query` rule queries the `search_events` table for events in the past 5 minutes (written by `SearchEventRecorder`). The `no_type_filter_noisy` rule counts `valid_to IS NULL` rows in the `fragments` table.

---

## Affective Tagging Internals (v2.9.0)

`fragments.affect` column (migration-034-v2.16.0-bundle). Allowed enum: `neutral | frustration | confidence | surprise | doubt | satisfaction`. Default: `neutral`.

- **Write path**: `FragmentWriter` calls `sanitizeAffect(value)` to coerce any value outside the allowed enum to `neutral` before INSERT/UPDATE.
- **Search filter**: `FragmentReader` search methods accept an `affect` parameter. A single string applies `= $N`; an array applies `= ANY($N::text[])`.
- **Index**: `idx_frag_affect` partial index (`affect IS NOT NULL AND affect != 'neutral'`) indexes only non-neutral values (the minority), keeping index size minimal while preserving query performance for filtered searches.

---

## Tool Meta Registry Internals (v2.9.0)

Each MCP tool definition now includes a `meta` field, automatically included in `tools/list` responses.

| Field | Type | Description |
|-------|------|-------------|
| `capabilities` | string[] | Functional labels describing what the tool does |
| `riskLevel` | `"low"` \| `"medium"` \| `"high"` | Risk indicator for client UI |
| `requiresMaster` | boolean | Whether the tool requires a master key |
| `beta` | boolean | Whether the tool is experimental |
| `idempotent` | boolean | Whether the tool is safe to retry |

The `GET /openapi.json` endpoint also reflects this metadata. Clients can use `riskLevel` to show confirmation prompts, or use `requiresMaster` to route calls to audit logs.

---

## Token-Based Session Reuse Internals (v2.9.0)

When the same Bearer token is used for consecutive `initialize` requests, the server reuses the existing active session instead of creating a new one.

**Cache key derivation (`deriveTokenKey`):**

```
hash = sha256(bearer_token).hex[:16]
tokenKey = "{keyId|'master'}:{hash}"
Redis key = "token_session:{tokenKey}"
```

The raw token is never stored; only the sha256 truncated hash is used as the key.

**Session reuse flow:**

1. On `initialize`, derive `tokenKey` from the request
2. `getSessionIdByToken(tokenKey)` → look up existing sessionId in Redis
3. If a valid session exists, return the same sessionId (no new session created)
4. If no session or expired, create a new session and call `bindTokenToSession(tokenKey, sessionId, ttlSec)`

Redis key TTL is synchronized with session TTL (default 30-day sliding). When Redis is disabled, token session reuse is inactive and every `initialize` creates a new session.

---

## Local transformers Embedding Pipeline Internals (v2.9.0)

When `EMBEDDING_PROVIDER=transformers` is set, `lib/embeddings/LocalTransformersEmbedder.js` handles embedding generation.

**Initialization flow:**

```
getLocalEmbedder(modelId, dimensions)
  → check singleton Map (_singletons)
  → if absent: new LocalTransformersEmbedder({ modelId, dimensions })
  → pipeline("feature-extraction", modelId, { dtype: "q8" }) — lazy load
```

The `@huggingface/transformers` `pipeline()` function is called with `dtype: "q8"`, loading the model in INT8 quantized form to halve memory usage.

**Embedding generation:**

```js
const output = await this._pipeline(text, { pooling: "mean", normalize: true });
```

`pooling: "mean"` averages token vectors; `normalize: true` applies L2 normalization. The result is passed through `normalizeL2()` again to correct floating-point drift.

**Shared runtime with Reranker/NLIClassifier:** All three modules use `@huggingface/transformers` but load different pipeline tasks (`feature-extraction` / `text-ranking` / `zero-shot-classification`). The ONNX Runtime instance is shared within the process, so additional memory overhead is minimal.

**Memory budget reference:**

| Component | Model | Size (Q8) |
|-----------|-------|----------|
| LocalEmbedder (e5-small) | Xenova/multilingual-e5-small | ~150 MB |
| LocalEmbedder (e5-base) | Xenova/multilingual-e5-base | ~300 MB |
| Reranker (minilm) | Xenova/ms-marco-MiniLM-L-6-v2 | ~80 MB |
| Reranker (bge-m3) | onnx-community/bge-reranker-v2-m3-ONNX | ~280 MB |
| NLIClassifier | Xenova/mDeBERTa-v3-base-mnli-xnli | ~250 MB |
