# Installation Guide

## Choose Your Starting Path

- Fastest bootstrap: [Quick Start](getting-started/quickstart.md)
- Best Windows path: [Windows WSL2 Setup](getting-started/windows-wsl2.md)
- Bash-free Windows path: [Windows PowerShell Setup](getting-started/windows-powershell.md)
- Claude Code integration: [Claude Code Configuration](getting-started/claude-code.md)
- Post-install verification: [First Memory Flow](getting-started/first-memory-flow.md)
- Common failures: [Troubleshooting](getting-started/troubleshooting.md)

## Support Policy

- Linux / macOS: standard path
- Windows: WSL2 Ubuntu recommended
- Windows PowerShell: limited support
- `setup.sh`: assumes a Bash environment

## Quick Start (Interactive Setup Script)

```bash
bash setup.sh
```

Guides you through `.env` creation, `npm install`, and DB schema setup step by step.

---

## Manual Installation

## Dependencies

```bash
npm install

# (Optional) If npm install fails on a CUDA 11 system due to onnxruntime-node GPU binding:
# npm install --onnxruntime-node-install-cuda=skip
```

**Note on ONNX Runtime and CUDA:** On systems with CUDA 11 installed, `npm install` may fail during `onnxruntime-node` post-install. Use `npm install --onnxruntime-node-install-cuda=skip` to force CPU-only mode. This project does not require GPU acceleration.

## PostgreSQL Schema

The `pgvector` extension must be installed prior to schema initialization:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Verify with `\dx` in psql. The HNSW index requires pgvector 0.5.0 or later.

**Fresh install:**

```bash
psql -U $POSTGRES_USER -d $POSTGRES_DB -f lib/memory/memory-schema.sql
```

## Upgrade (Existing Installation)

Run migrations in order:

```bash
# Temporal schema: adds valid_from, valid_to, superseded_by columns and indexes
psql $DATABASE_URL -f lib/memory/migration-001-temporal.sql

# Decay idempotency: adds last_decay_at column
psql $DATABASE_URL -f lib/memory/migration-002-decay.sql

# API key management: creates api_keys and api_key_usage tables
psql $DATABASE_URL -f lib/memory/migration-003-api-keys.sql

# API key isolation: adds key_id column to fragments
psql $DATABASE_URL -f lib/memory/migration-004-key-isolation.sql

# GC policy reinforcement: adds auxiliary indexes on utility_score and access_count
psql $DATABASE_URL -f lib/memory/migration-005-gc-columns.sql

# fragment_links constraint: adds superseded_by to relation_type CHECK
psql $DATABASE_URL -f lib/memory/migration-006-superseded-by-constraint.sql

# Link weight column for Hebbian co-retrieval strength
psql $DATABASE_URL -f lib/memory/migration-007-link-weight.sql

# Morpheme dictionary table for Korean tokenization
psql $DATABASE_URL -f lib/memory/migration-008-morpheme-dict.sql

# fragment_links CHECK: adds co_retrieved relation type
psql $DATABASE_URL -f lib/memory/migration-009-co-retrieved.sql

# EMA activation columns for dynamic decay half-life
psql $DATABASE_URL -f lib/memory/migration-010-ema-activation.sql

# API key groups (N:M mapping for cross-agent memory sharing)
psql $DATABASE_URL -f lib/memory/migration-011-key-groups.sql

# Quality verification column
psql $DATABASE_URL -f lib/memory/migration-012-quality-verified.sql

# Search events observability table
psql $DATABASE_URL -f lib/memory/migration-013-search-events.sql

# TTL short-lived fragments
psql "$DATABASE_URL" -f lib/memory/migration-014-ttl-short.sql

# created_at index for time-range queries
psql "$DATABASE_URL" -f lib/memory/migration-015-created-at-index.sql

# agent_id + topic composite index
psql "$DATABASE_URL" -f lib/memory/migration-016-agent-topic-index.sql

# Episodic memory table and indexes
psql "$DATABASE_URL" -f lib/memory/migration-017-episodic.sql

# OAuth client registration
psql $DATABASE_URL -f lib/memory/migration-021-oauth-clients.sql

# Narrative Reconstruction columns
psql $DATABASE_URL -f lib/memory/migration-025-case-id-episode.sql
psql $DATABASE_URL -f lib/memory/migration-026-case-events.sql

# v2.5.0: Reconsolidation, Episode Continuity, Spreading Activation
psql $DATABASE_URL -f lib/memory/migration-027-v25-reconsolidation-episode-spreading.sql

# v2.5.3: Composite indexes, used_rrf consolidation, superseded_by removal
psql $DATABASE_URL -f lib/memory/migration-028-v253-improvements.sql

# v2.5.6: SearchParamAdaptor learning table
psql $DATABASE_URL -f lib/memory/migration-029-search-param-thresholds.sql

# v2.6.0: search_param_thresholds.key_id INTEGER → TEXT
psql $DATABASE_URL -f lib/memory/migration-030-search-param-thresholds-key-text.sql

# v2.7.0: content_hash global UNIQUE → per-tenant partial unique index
psql $DATABASE_URL -f lib/memory/migration-031-content-hash-per-key.sql

# v2.8.0: fragment_claims table + tenant isolation partial unique
psql $DATABASE_URL -f lib/memory/migration-032-fragment-claims.sql

# v2.8.0: api_keys.symbolic_hard_gate column
psql $DATABASE_URL -f lib/memory/migration-033-symbolic-hard-gate.sql

# v2.9.0: api_keys.default_mode column (mode preset system)
psql $DATABASE_URL -f lib/memory/migration-034-v2.16.0-bundle.sql  # api_keys.default_mode + fragments.affect + fragments.idempotency_key (v2.9.0~v2.12.0 single bundle)

# v2.9.0: fragments.affect column + partial index (affective tagging)

# v2.12.0: fragments.idempotency_key column + two per-tenant partial unique indexes
```

> **Re-running migration-007**: If you change `EMBEDDING_DIMENSIONS` or switch embedding providers, re-run `scripts/post-migrate-flexible-embedding-dims.js` to update the vector column dimensions in both the `fragments` and `morpheme_dict` tables simultaneously. (The backward-compatible symlink at `scripts/migration-007-flexible-embedding-dims.js` was removed in v3.1.0.)

Since v1.8.0, automatic migration is supported. Instead of running each file manually:

```bash
DATABASE_URL=postgresql://user:pass@host:port/dbname npm run migrate
```

> **migration-034-v2.16.0-bundle CONCURRENTLY option**: migration-034-v2.16.0-bundle runs inside a transaction, so it uses `CREATE UNIQUE INDEX` (not CONCURRENTLY). For large production tables (millions of fragments) where minimizing lock time is critical, run the two statements below manually before `npm run migrate`. The IF NOT EXISTS guard ensures they are safely skipped during automatic execution.
>
> ```sql
> CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_fragments_idempotency_tenant
>   ON agent_memory.fragments (key_id, idempotency_key)
>   WHERE idempotency_key IS NOT NULL AND key_id IS NOT NULL;
>
> CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_fragments_idempotency_master
>   ON agent_memory.fragments (idempotency_key)
>   WHERE idempotency_key IS NOT NULL AND key_id IS NULL;
> ```

### v2.9.x to v2.12.0 Upgrade Path

```bash
# 1. Update dependencies
npm install

# 2. Run migrations (includes migration-034-v2.16.0-bundle)
npm run migrate

# 3. Review EMBEDDING_PROVIDER
#    If you changed the provider or EMBEDDING_DIMENSIONS:
#    EMBEDDING_DIMENSIONS=N DATABASE_URL=$DATABASE_URL node scripts/post-migrate-flexible-embedding-dims.js
#    DATABASE_URL=$DATABASE_URL node scripts/backfill-embeddings.js

# 4. Check .env for new entries
#    Add MEMENTO_CLI_REMOTE and MEMENTO_CLI_KEY if using the CLI in remote mode

# 5. Restart the server
node server.js
```

Verify migration-034-v2.16.0-bundle index application:

```sql
-- In psql
\d agent_memory.fragments
-- Both idx_fragments_idempotency_tenant and idx_fragments_idempotency_master should appear.
```

Applied migrations are tracked in `agent_memory.schema_migrations`. Only unapplied files are executed in order.

> **Upgrading from v1.1.0 or earlier**: If migration-006 is not applied, any operation that creates a `superseded_by` link — `amend`, `memory_consolidate`, and automatic relationship generation in GraphLinker — will fail with a DB constraint error. This migration is mandatory when upgrading an existing database.

```bash
# For models with >2000 dimensions (e.g., Gemini gemini-embedding-001 at 3072 dims) only:
# EMBEDDING_DIMENSIONS=3072 DATABASE_URL=$DATABASE_URL \
#   node scripts/post-migrate-flexible-embedding-dims.js

# One-time L2 normalization of existing embeddings (safe to re-run; idempotent)
DATABASE_URL=$DATABASE_URL node lib/memory/normalize-vectors.js

# Backfill embeddings for existing fragments (requires embedding API key, one-time)
npm run backfill:embeddings
```

## Environment Variables

For the fastest bootstrap:

```bash
cp .env.example.minimal .env
```

For the full operational sample:

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL, MEMENTO_ACCESS_KEY, and other required values
```

Additional environment variables:

```
LLM_PRIMARY             - Primary LLM provider (default: gemini-cli). Options: gemini-cli, codex, copilot, anthropic, etc.
LLM_FALLBACKS           - JSON array of fallback providers: [{"provider":"anthropic","apiKey":"...","model":"claude-opus-4-6"}]
```

For the full list of environment variables, see [Configuration — Environment Variables](configuration.md#environment-variables).

---

## Local Embedding Mode (No OpenAI API Key Required)

You can generate embeddings using a local `@huggingface/transformers` model without an OpenAI API key.

### .env Configuration

```
EMBEDDING_PROVIDER=transformers
EMBEDDING_MODEL=Xenova/multilingual-e5-small
EMBEDDING_DIMENSIONS=384
# Do NOT set EMBEDDING_API_KEY — mixing local and API providers corrupts the vector space
```

Supported local models:

| Model | Size | Dimensions | Notes |
|-------|------|-----------|-------|
| `Xenova/multilingual-e5-small` | ~120 MB | 384 | Recommended starting point |
| `Xenova/multilingual-e5-base` | ~280 MB | 768 | Higher accuracy |

Setting `EMBEDDING_PROVIDER=transformers` together with `EMBEDDING_API_KEY` will cause the server to exit immediately on startup to prevent vector space corruption.

### First-Run Model Download

On first startup, the model is automatically downloaded from HuggingFace Hub. For `Xenova/multilingual-e5-small` (~120 MB), this may take a few minutes depending on network speed. Subsequent starts load from the local cache.

```
[LocalEmbedder] loading model Xenova/multilingual-e5-small (dtype=q8)
```

### Cache Path (HF_HOME)

Default cache location: `~/.cache/huggingface`

For Docker deployments, mount the cache directory as a volume to avoid re-downloading on container restart:

```yaml
volumes:
  - hf_cache:/root/.cache/huggingface
environment:
  - HF_HOME=/root/.cache/huggingface
```

For full details, see [docs/embedding-local.md](embedding-local.md).

---

## Optional Dependencies

### gemini CLI (default LLM provider)

```bash
npm install -g @google/gemini-cli
gemini auth login
```

### Codex CLI (LLM fallback)

```bash
npm install -g @openai/codex
codex auth login
```

### Copilot CLI (LLM fallback)

```bash
npm install -g @githubnext/github-copilot-cli
github-copilot-cli auth
```

To use a CLI provider, set `LLM_PRIMARY` or `LLM_FALLBACKS` to `"codex"` or `"copilot"`.

---

## Post-Startup Verification Checklist

After the server starts, verify the following in order:

```bash
# 1. Health endpoint returns 200
curl -s http://localhost:57332/health | jq .status

# 2. Check server log for embedding consistency (printed at startup)
# Success: "consistency check result: PASS"
# Failure: review EMBEDDING_DIMENSIONS and re-run migration-007 if needed

# 3. CLI diagnostics
node bin/memento.js health
```

A `consistency check result: PASS` log line confirms that `EMBEDDING_DIMENSIONS` matches the actual vector dimensions stored in the database. If `FAIL` appears, re-run `scripts/post-migrate-flexible-embedding-dims.js` and restart the server.

## Starting the Server

```bash
node server.js
```

On startup, the server logs the listening port, authentication status, session TTL, confirms `MemoryEvaluator` worker initialization, and begins NLI model preloading in the background (~30s on first download, ~1-2s from cache). Graceful shutdown on `SIGTERM` / `SIGINT` triggers `AutoReflect` for all active sessions, stops `MemoryEvaluator`, drains the PostgreSQL connection pool, and flushes access statistics.

## MCP Client Configuration

See [Claude Code Configuration](getting-started/claude-code.md) for the dedicated setup guide.

For external access, expose the service through a reverse proxy (TLS termination, rate limiting). Do not publish internal host addresses or port numbers in external documentation.

## Hook-Based Context Loading

Memento's `instructions` field encourages the AI to use memory tools actively, but this alone doesn't automatically inject past memories at session start. With Claude Code hooks, you can ensure the AI loads relevant context at the beginning of every session.

**Auto-load Core Memory on session start** (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://localhost:57332/mcp -H 'Authorization: Bearer YOUR_KEY' -H 'Content-Type: application/json' -H 'mcp-session-id: ${MCP_SESSION_ID}' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"context\",\"arguments\":{}}}'"
          }
        ]
      }
    ]
  }
}
```

Alternatively, add the following to your `CLAUDE.md` to have the AI load context on its own:

```markdown
## Session Start Rules
- At the start of every conversation, call the `context` tool to load Core Memory and Working Memory.
- Before debugging or writing code, call `recall(keywords=[relevant_keywords], type="error")` to surface related past learnings.
```

`context` returns only high-importance fragments within your token budget, so it injects critical information without polluting the context window. Combining session hooks with `CLAUDE.md` instructions significantly reduces the "amnesia effect" where the AI behaves as if meeting you for the first time each session.

## MCP Protocol Version Negotiation

| Version | Notable Additions |
|---------|------------------|
| `2025-11-25` | Tasks abstraction, long-running operation support |
| `2025-06-18` | Structured tool output, server-driven interaction |
| `2025-03-26` | OAuth 2.1, Streamable HTTP transport |
| `2024-11-05` | Initial release; Legacy SSE transport |

The server advertises all four versions. Clients negotiate the highest mutually supported version during `initialize`.
