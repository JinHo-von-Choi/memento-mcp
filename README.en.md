<p align="center">
  <img src="assets/images/memento_mcp_logo_transparent.png" width="400" alt="Memento MCP Logo">
</p>

<p align="center">
  <a href="https://github.com/JinHo-von-Choi/memento-mcp/releases">
    <img src="https://img.shields.io/github/v/release/JinHo-von-Choi/memento-mcp?style=flat&label=release&color=4c8bf5" alt="GitHub Release" />
  </a>
  <a href="https://github.com/JinHo-von-Choi/memento-mcp/stargazers">
    <img src="https://img.shields.io/github/stars/JinHo-von-Choi/memento-mcp?style=flat&color=f5c542" alt="GitHub Stars" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat" alt="License" />
  </a>
  <a href="https://lobehub.com/mcp/jinho-von-choi-memento-mcp">
    <img src="https://lobehub.com/badge/mcp/jinho-von-choi-memento-mcp" alt="MCP Badge" />
  </a>
</p>

# Memento MCP

> Give your AI a memory.

Imagine a new employee whose memory resets every morning. Everything you taught yesterday, every problem you solved together last week, every preference -- all forgotten. Memento MCP gives this new hire a memory.

Memento MCP is a long-term memory server for AI agents, built on MCP (Model Context Protocol). It persists important facts, decisions, error patterns, and procedures across sessions and restores them in the next.

## 30-Second Demo

Teach your AI something, then watch it recall the knowledge in a new session:

```
[Session 1]
User: "Our project uses PostgreSQL 15, and we run tests with Vitest."
  -> AI calls remember -> 2 fragments saved

[Session 2 -- next day]
  -> AI calls context -> "Uses PostgreSQL 15", "Vitest for testing" auto-restored
User: "How do I run the tests again?"
  -> AI calls recall -> returns the "Vitest" fragment
  -> AI: "This project uses Vitest. Run npx vitest."
```

No more repeating yourself every session.

## Installation

Requirements: Node.js 20+, PostgreSQL (pgvector extension)

```bash
cp .env.example.minimal .env
# Edit .env, then export to shell
export $(grep -v '^#' .env | grep '=' | xargs)
npm install
npm run migrate
node server.js
```

Once the server is running, verify it with the [First Memory Flow](docs/getting-started/first-memory-flow.md).

For other platforms, see the [Compatible Platforms](#compatible-platforms) table above.

### Claude Code Integration

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "memento": {
      "url": "http://localhost:57332/mcp",
      "headers": { "Authorization": "Bearer YOUR_ACCESS_KEY" }
    }
  }
}
```

See [Claude Code Configuration](docs/getting-started/claude-code.md) for details.

### Supported Environments

| Environment | Recommendation | Getting Started |
|-------------|----------------|-----------------|
| Linux / macOS | Recommended | [Quick Start](docs/getting-started/quickstart.md) |
| Windows + WSL2 | Most recommended | [Windows WSL2 Setup](docs/getting-started/windows-wsl2.md) |
| Windows + PowerShell | Limited support | [Windows PowerShell Setup](docs/getting-started/windows-powershell.md) |

## Compatible Platforms

Memento is a standard MCP (Model Context Protocol) server. It works with any AI platform that supports MCP — not just Claude Code.

| Platform | Config Location | Transport |
|----------|----------------|-----------|
| Claude Code | ~/.claude/settings.json | Streamable HTTP |
| Claude Desktop | claude_desktop_config.json | Streamable HTTP |
| Cursor | .cursor/mcp.json | Streamable HTTP |
| Windsurf | ~/.codeium/windsurf/mcp_config.json | Streamable HTTP |
| GitHub Copilot | VS Code MCP Marketplace | Streamable HTTP |
| Codex CLI | ~/.codex/config.toml | Streamable HTTP |
| ChatGPT Desktop | Developer Mode > Apps | Streamable HTTP |
| Continue | config.json | Streamable HTTP |

Common setup: Server URL `http://localhost:57332/mcp`, Authorization header `Bearer YOUR_ACCESS_KEY`.

See [integration guides](docs/getting-started/) for platform-specific setup.

## Core Features

| Feature | Description |
|---------|-------------|
| `remember` | Decomposes important information into atomic fragments and stores them |
| `recall` | Returns relevant memories via keyword + semantic 3-tier search |
| `context` | Automatically restores key context at session start |
| Auto-cleanup | Duplicate merging, contradiction detection, importance decay, TTL-based forgetting |
| Admin Console | Memory explorer, knowledge graph, statistics dashboard |

See [SKILL.md](SKILL.md) for the full list of MCP tools.

## Memory vs Rules

Memory fragments injected by Memento have lower priority than the system prompt. Factual memories like "we use PostgreSQL 15" work well, but behavioral rules like "always use Given-When-Then pattern in tests" may be ignored when they conflict with the system prompt.

For behavioral rules, use higher-priority channels such as CLAUDE.md, AGENTS.md, hooks, or skills.

## Benchmark

Performance on [LongMemEval-S](https://arxiv.org/abs/2407.15460) (500 questions):

| Metric | Score | Comparison |
|--------|-------|------------|
| Retrieval recall@5 | 88.3% | +8-18pp vs Stella 1.5B (LongMemEval paper) |
| QA accuracy | 45.4% | with temporal metadata (baseline 40.4%) |
| Fragment throughput | 89,006 / 27s | full ingestion-embedding-retrieval pipeline |

Retrieval exceeds 80% recall on 5 of 6 question types. However, a significant gap exists between retrieval recall (88.3%) and QA accuracy (45.4%). This reflects reader-stage limitations in synthesizing answers from retrieved fragments, particularly for multi-session and temporal reasoning questions.

See [Benchmark Report](docs/benchmark.en.md) for the full analysis.

## Usage Patterns

Memento is optimized for fact caching. When narrative context matters:

- Use the `episode` type to store narratives that preserve "why" behind decisions
- Add `contextSummary` when storing facts to get context alongside recall results
- A dual-memory setup works well: fact retrieval via Memento, context restoration via your main memory system (e.g., MEMORY.md)

## Who Is This For

- Developers who use AI agents (Claude Code / Cursor / Windsurf) daily
- Anyone tired of repeating the same explanations every session
- Anyone who wants their AI to remember project context

## Learn More

| Document | Contents |
|----------|----------|
| [Quick Start](docs/getting-started/quickstart.md) | Detailed installation guide |
| [Architecture](docs/architecture.en.md) | System design, DB schema, 3-tier search, TTL |
| [Configuration](docs/configuration.en.md) | Environment variables, MEMORY_CONFIG, embedding providers |
| [API Reference](docs/api-reference.en.md) | HTTP endpoints, prompts, resources |
| [CLI](docs/cli.en.md) | 9 terminal commands |
| [Internals](docs/internals.en.md) | Evaluator, consolidator, contradiction detection |
| [Benchmark](docs/benchmark.en.md) | Full LongMemEval-S benchmark analysis |
| [SKILL.md](SKILL.md) | Full MCP tool reference |
| [INSTALL.md](docs/INSTALL.en.md) | Migrations, hook setup, detailed installation |
| [CHANGELOG](CHANGELOG.md) | Version history |

## Operations

- `/health`: Comprehensive check of DB, Redis, pgvector, and worker status. Returns degraded on partial failure.
- Rate Limiting: 100/min per API key, 30/min per IP. Configurable via environment variables.
- Worker Recovery: Embedding/evaluator workers use exponential backoff (1s→60s) on errors.
- Graceful Shutdown: On SIGTERM, waits up to 30s for workers to drain, then runs session auto-reflect.

## Known Limitations

- L1 Redis cache supports API key-based isolation only. Agent-level isolation in multi-agent deployments is enforced at L2/L3.
- Automatic quality evaluation targets decision, preference, and relation types only. fact, procedure, and error types are excluded from the evaluation queue.
- Authentication is disabled when MEMENTO_ACCESS_KEY is not set. Always configure it for externally exposed deployments.

## Tech Stack

- Node.js 20+
- PostgreSQL 14+ (pgvector extension)
- Redis 6+ (optional)
- OpenAI Embedding API (optional)
- Gemini CLI (quality evaluation, contradiction escalation, auto-reflect summaries; optional)
- @huggingface/transformers + ONNX Runtime (NLI contradiction classification, CPU-only, auto-installed)
- MCP Protocol 2025-11-25

The core features work with PostgreSQL alone. Adding Redis enables L1 cascade search and SessionActivityTracker. Adding the OpenAI API enables L3 semantic search and automatic linking.

## Why I Built This

<details>
<summary>Expand</summary>

Working with AI in production, I kept wasting time re-explaining the same context every single day. I tried embedding notes in system prompts, but the limitations were obvious. As fragments piled up, management fell apart -- search stopped working, and old information clashed with new.

The biggest problem was the endless repetition. Having to re-state things I had already explained, re-confirm settings that were already in place. I would painstakingly correct the AI, get it working perfectly -- only to start a new session and face the exact same issues all over again. It felt like being the training supervisor for a brilliant new hire who graduated top of their class but has their memory wiped clean every morning.

"Do you remember Mijeong?" -- without a cue, nothing comes to mind. But say "your desk mate from first grade" and suddenly you remember her lending you an eraser. AI works the same way. The bug you fixed yesterday, the decision you made last week, your preferred coding style. Instead of resetting every session, Memento remembers for you.

To solve this pain, I designed a system that decomposes memories into atomic units, searches them hierarchically, and lets them decay naturally over time. Just as humans are creatures of forgetting, this system embraces "appropriate forgetting" as a feature.

---

Memory is not the prerequisite of intelligence. Memory is the condition for it. Even if you know how to play chess, failing to remember yesterday's lost game means repeating the same moves. Even if you speak every language, failing to remember yesterday's conversation means meeting a stranger every time. Even with billions of parameters holding all the world's knowledge, failing to remember yesterday with you makes the AI nothing more than an unfamiliar polymath.

Memory is what enables relationships. Relationships are what enable trust.

Memories do not disappear. They simply drop to the cold tier. And cold fragments left neglected long enough are purged in the next consolidate cycle. This is by design, not a bug. Useless memories must make room. Even the palace of Augustine needs its storeroom tidied.

Even a goldfish -- famously considered brainless -- can remember things for months.

Now your AI can too.

</details>

## License

Apache 2.0

---

<p align="center">
  Made by <a href="mailto:jinho.von.choi@nerdvana.kr">Jinho Choi</a> &nbsp;|&nbsp;
  <a href="https://buymeacoffee.com/jinho.von.choi">Buy me a coffee</a>
</p>
