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

## Core Features

| Feature | Description |
|---------|-------------|
| `remember` | Decomposes important information into atomic fragments and stores them |
| `recall` | Returns relevant memories via keyword + semantic 3-tier search |
| `context` | Automatically restores key context at session start |
| Auto-cleanup | Duplicate merging, contradiction detection, importance decay, TTL-based forgetting |
| Admin Console | Memory explorer, knowledge graph, statistics dashboard |

See [SKILL.md](SKILL.md) for the full list of MCP tools.

## Benchmark

Performance on [LongMemEval-S](https://arxiv.org/abs/2407.15460) (500 questions):

| Metric | Score | Comparison |
|--------|-------|------------|
| Retrieval recall@5 | 88.3% | +8-18pp vs Stella 1.5B (LongMemEval paper) |
| QA accuracy | 45.4% | with temporal metadata (baseline 40.4%) |
| Fragment throughput | 89,006 / 27s | full ingestion-embedding-retrieval pipeline |

Retrieval exceeds 80% recall on 5 of 6 question types. The sole weak spot is assistant-utterance queries (53.6%), caused by a mismatch between storage format and query semantics.

See [Benchmark Report](docs/benchmark.md) for the full analysis.

## Who Is This For

- Developers who use AI agents (Claude Code / Cursor / Windsurf) daily
- Anyone tired of repeating the same explanations every session
- Anyone who wants their AI to remember project context

## Learn More

| Document | Contents |
|----------|----------|
| [Quick Start](docs/getting-started/quickstart.md) | Detailed installation guide |
| [Architecture](docs/architecture.md) | System design, DB schema, 3-tier search, TTL |
| [Configuration](docs/configuration.md) | Environment variables, MEMORY_CONFIG, embedding providers |
| [API Reference](docs/api-reference.md) | HTTP endpoints, prompts, resources |
| [CLI](docs/cli.md) | 9 terminal commands |
| [Internals](docs/internals.md) | Evaluator, consolidator, contradiction detection |
| [Benchmark](docs/benchmark.md) | Full LongMemEval-S benchmark analysis |
| [SKILL.md](SKILL.md) | Full MCP tool reference |
| [INSTALL.md](docs/INSTALL.md) | Migrations, hook setup, detailed installation |
| [CHANGELOG](CHANGELOG.md) | Version history |

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
