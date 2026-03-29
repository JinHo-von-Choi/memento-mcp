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
```

Since v1.8.0, automatic migration is supported. Instead of running each file manually:

```bash
DATABASE_URL=postgresql://user:pass@host:port/dbname npm run migrate
```

Applied migrations are tracked in `agent_memory.schema_migrations`. Only unapplied files are executed in order.

> **Upgrading from v1.1.0 or earlier**: If migration-006 is not applied, any operation that creates a `superseded_by` link — `amend`, `memory_consolidate`, and automatic relationship generation in GraphLinker — will fail with a DB constraint error. This migration is mandatory when upgrading an existing database.

```bash
# For models with >2000 dimensions (e.g., Gemini gemini-embedding-001 at 3072 dims) only:
# EMBEDDING_DIMENSIONS=3072 DATABASE_URL=$DATABASE_URL \
#   node lib/memory/migration-007-flexible-embedding-dims.js

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

For the full list of environment variables, see [Configuration — Environment Variables](configuration.md#environment-variables).

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
