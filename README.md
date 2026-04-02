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

<p align="center">
  <a href="README.en.md">📖 English Documentation</a>
</p>

# Memento MCP

> AI에게 기억을 줍니다.

매일 아침 기억이 리셋되는 신입직원을 상상해보라. 어제 가르친 것도, 지난주 함께 해결한 문제도, 취향도 전부 까먹는다. Memento MCP는 이 신입에게 기억을 심어준다.

Memento MCP는 MCP(Model Context Protocol) 기반 에이전트 장기 기억 서버다. 세션이 종료되어도 중요한 사실, 결정, 에러 패턴, 절차를 유지하고 다음 세션에서 복원한다.

## 30초 체험

AI에게 무언가를 기억시키고, 다음 세션에서 꺼내 보는 흐름이다:

```
[세션 1]
사용자: "우리 프로젝트는 PostgreSQL 15를 쓰고, 테스트는 Vitest로 돌려"
  → AI가 remember 호출 → 파편 2개 저장

[세션 2 — 다음 날]
  → AI가 context 호출 → "PostgreSQL 15 사용", "Vitest 테스트" 자동 복원
사용자: "테스트 어떻게 돌리더라?"
  → AI가 recall 호출 → "Vitest로 테스트 실행" 파편 반환
  → AI: "이 프로젝트는 Vitest를 사용합니다. npx vitest로 실행하세요."
```

매 세션마다 같은 설명을 반복할 필요가 없다.

## 설치

필수: Node.js 20+, PostgreSQL (pgvector 확장)

```bash
cp .env.example.minimal .env
# .env 값을 편집한 뒤 셸에 반영
export $(grep -v '^#' .env | grep '=' | xargs)
npm install
npm run migrate
node server.js
```

서버가 뜬 뒤에는 [First Memory Flow](docs/getting-started/first-memory-flow.md)로 동작을 검증한다.

다른 플랫폼 설정은 위 [호환 플랫폼](#호환-플랫폼) 테이블 참조.

### 업데이트

```bash
cd ~/memento-mcp
git pull origin main
npm install
npm run migrate
# 서비스 재시작 (systemd / pm2 / docker 등 환경에 맞게)
```

- `npm run migrate`는 `.env`의 DB 설정을 자동으로 사용한다. `DATABASE_URL` 수동 지정 불필요.
- pgvector 스키마는 자동 감지된다. `PGVECTOR_SCHEMA` 설정은 대부분 불필요.

### Claude Code 연동

`.claude/settings.json`에 추가:

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

상세 설정은 [Claude Code Configuration](docs/getting-started/claude-code.md) 참조.

### 지원 환경

| 환경 | 권장도 | 시작 문서 |
|------|--------|-----------|
| Linux / macOS | 권장 | [Quick Start](docs/getting-started/quickstart.md) |
| Windows + WSL2 | 가장 권장 | [Windows WSL2 Setup](docs/getting-started/windows-wsl2.md) |
| Windows + PowerShell | 제한 지원 | [Windows PowerShell Setup](docs/getting-started/windows-powershell.md) |

## 호환 플랫폼

Memento는 MCP(Model Context Protocol) 표준 서버다. Claude Code뿐 아니라, MCP를 지원하는 모든 AI 플랫폼에서 사용할 수 있다.

| 플랫폼 | 설정 위치 | 연결 방식 |
|--------|----------|-----------|
| Claude Code | ~/.claude/settings.json | Streamable HTTP |
| Claude Desktop | claude_desktop_config.json | Streamable HTTP |
| Claude.ai Web | Settings > Integrations | OAuth (RFC 7591) |
| Cursor | .cursor/mcp.json | Streamable HTTP |
| Windsurf | ~/.codeium/windsurf/mcp_config.json | Streamable HTTP |
| GitHub Copilot | VS Code MCP Marketplace | Streamable HTTP |
| Codex CLI | ~/.codex/config.toml | Streamable HTTP |
| ChatGPT Desktop | Developer Mode > Apps | OAuth (RFC 7591) |
| Continue | config.json | Streamable HTTP |

공통 설정: 서버 URL `http://localhost:57332/mcp`, Authorization 헤더에 `Bearer YOUR_ACCESS_KEY`.

Claude.ai Web / ChatGPT 연동은 OAuth를 사용한다. 발급한 API 키(`mmcp_xxx`)를 `client_id`로 입력하면 Dynamic Client Registration(RFC 7591) 없이 바로 연결된다. 신뢰 도메인(claude.ai, chatgpt.com)의 redirect URI는 자동 승인된다.

플랫폼별 상세 설정은 [연동 가이드](docs/getting-started/) 참조.

## 핵심 기능

| 기능 | 설명 |
|------|------|
| `remember` | 중요한 정보를 원자적 파편으로 분해하여 저장 |
| `recall` | 키워드 + 시맨틱 3계층 검색으로 필요한 기억만 반환 |
| `context` | 세션 시작 시 핵심 맥락을 자동 복원 |
| 자동 정리 | 중복 병합, 모순 탐지, 중요도 감쇠, TTL 기반 망각 |
| 관리 콘솔 | 기억 탐색, 지식 그래프, 통계 대시보드, API 키 그룹/상태 필터, daily-limit 인라인 편집 |
| OAuth 연동 | RFC 7591 Dynamic Client Registration, Claude.ai / ChatGPT Web 통합 지원 |
| **Workspace 격리** | 같은 키 내에서도 프로젝트·직종·클라이언트 단위로 기억을 분리. `api_keys.default_workspace`로 자동 태깅, 검색 시 자동 필터. |

전체 MCP 도구 목록은 [SKILL.md](SKILL.md) 참조.

## 기억 vs 규칙

Memento가 주입하는 기억 파편은 시스템 프롬프트보다 우선순위가 낮다. "PostgreSQL 15를 쓴다"같은 사실 기억은 잘 작동하지만, "테스트 작성 시 반드시 Given-When-Then 패턴을 쓸 것"같은 행동 규칙은 시스템 프롬프트와 충돌하면 무시될 수 있다.

행동 규칙은 CLAUDE.md, AGENTS.md, 훅(hooks), 스킬(skills) 등 우선순위가 높은 채널에 설정하는 것을 권장한다.

## 벤치마크

[LongMemEval-S](https://arxiv.org/abs/2407.15460) 500문항 기준 성능:

| 지표 | 점수 | 비교 |
|------|------|------|
| 검색 recall@5 | 88.3% | LongMemEval 논문 Stella 1.5B 대비 +8~18pp |
| QA 정답률 | 45.4% | temporal metadata 적용 (baseline 40.4%) |
| 파편 처리량 | 89,006개 / 27초 | 인제스천 + 임베딩 + 검색 전체 파이프라인 |

검색은 6개 문항 유형 중 5개에서 80% 이상 recall을 달성한다. 다만 검색 recall(88.3%)과 QA 정답률(45.4%) 사이에 큰 gap이 존재한다. 이는 검색된 파편에서 정답을 합성하는 reader 단계의 한계로, multi-session 추론과 시간축 추론에서 특히 두드러진다.

상세 분석은 [Benchmark Report](docs/benchmark.md) 참조.

## 사용 패턴

Memento는 사실 기억(fact cache)에 최적화되어 있다. 전후관계가 중요한 경우:

- `episode` 유형으로 서사를 저장하면 "왜 그런 결정을 했는지"까지 복원 가능
- `contextSummary`를 함께 저장하면 recall 시 맥락이 함께 반환됨
- 메인 메모리 시스템(MEMORY.md 등)과 병행하여 사실 검색은 Memento, 맥락 복원은 메인 메모리로 역할 분담하는 이원화 구조도 효과적

## 누가 쓰면 좋은가

- Claude Code / Cursor / Windsurf 등 AI 에이전트를 매일 쓰는 개발자
- 세션마다 같은 설명을 반복하는 게 짜증나는 사람
- AI에게 내 프로젝트 맥락을 기억시키고 싶은 사람

## 더 알아보기

| 문서 | 내용 |
|------|------|
| [Quick Start](docs/getting-started/quickstart.md) | 상세 설치 가이드 |
| [Architecture](docs/architecture.md) | 시스템 구조, DB 스키마, 3계층 검색, TTL |
| [Configuration](docs/configuration.md) | 환경 변수, MEMORY_CONFIG, 임베딩 Provider |
| [API Reference](docs/api-reference.md) | HTTP 엔드포인트, 프롬프트, 리소스 |
| [CLI](docs/cli.md) | 터미널 명령어 9개 |
| [Internals](docs/internals.md) | 평가기, 통합기, 모순 탐지 |
| [Benchmark](docs/benchmark.md) | LongMemEval-S 벤치마크 상세 분석 |
| [SKILL.md](SKILL.md) | MCP 도구 전체 레퍼런스 |
| [INSTALL.md](docs/INSTALL.md) | 마이그레이션, 훅 설정, 상세 설치 |
| [CHANGELOG](CHANGELOG.md) | 버전별 변경사항 |

## 운영

- `/health`: DB, Redis, pgvector, 워커 상태를 종합 점검. 부분 장애 시 degraded 응답.
- Rate Limiting: API 키당 100/분, IP당 30/분. 환경변수로 조정 가능.
- 워커 복구: 임베딩/평가 워커가 에러 시 지수 백오프(1s→60s)로 자동 재시도.
- Graceful Shutdown: SIGTERM 시 진행 중 워커 완료 대기(30초) 후 세션 auto-reflect 실행.
- OAuth 엔드포인트: 인증 실패 시 `WWW-Authenticate` 헤더를 반환하여 OAuth 클라이언트가 자동으로 인증 흐름을 시작할 수 있다. 세션 TTL 기본값은 240분이다.

## 알려진 제한사항

- L1 Redis 캐시는 API 키 기반 격리만 지원한다. multi-agent 환경에서 에이전트 간 격리는 L2/L3에서 적용된다.
- 자동 품질 평가는 decision, preference, relation 유형만 대상이다. fact, procedure, error는 평가 큐에서 제외된다.
- MEMENTO_ACCESS_KEY를 설정하지 않으면 인증이 비활성화된다. 외부 노출 환경에서는 반드시 설정할 것.

## 기술 스택

- Node.js 20+
- PostgreSQL 14+ (pgvector 확장)
- Redis 6+ (선택)
- OpenAI Embedding API (선택)
- Gemini CLI (품질 평가, 모순 에스컬레이션, 자동 reflect 요약 생성용, 선택)
- @huggingface/transformers + ONNX Runtime (NLI 모순 분류, CPU 전용, 자동 설치)
- MCP Protocol 2025-11-25

PostgreSQL만 있으면 핵심 기능이 동작한다. Redis를 추가하면 L1 캐스케이드 검색과 SessionActivityTracker가 활성화되고, OpenAI API를 추가하면 L3 시맨틱 검색과 자동 링크가 활성화된다.

## 만들게 된 계기

<details>
<summary>접기/펼치기</summary>

실무에서 AI를 쓰면서 매일 같은 맥락을 반복 설명하는 비효율을 느꼈다. 시스템 프롬프트에 메모를 넣는 방법도 써봤지만 한계가 명확했다. 파편 수가 늘어나면 관리가 안 되고, 검색이 안 되고, 오래된 정보와 새 정보가 충돌했다.

이미 설명한 것, 이미 세팅한 것을 무한히 반복하게 만드는 것이 가장 큰 문제였다. 인증 정보가 없다고 해서 보면 있고, 세팅 안 돼 있다고 해서 파일을 직접 열어보면 다 돼 있다. 철저하게 논파해서 말 잘 듣게 해 봐야 그때뿐이다. 세션을 다시 시작하면 같은 일이 또 반복된다. 명문대를 수석 졸업했지만 매일 뇌가 리셋되는 신입사원의 교육담당자가 된 기분이었다.

"야 너 미정이 기억나냐" -- 단서 없이는 아무것도 떠오르지 않지만, "초등학교 1학년 때 짝궁" 한마디면 지우개 빌려줬던 일까지 줄줄이 떠오른다. AI도 마찬가지다. 어제 해결한 버그, 지난주 내린 결정, 선호하는 코딩 스타일. 매 세션 리셋 대신, Memento가 기억해둔다.

이 고충을 해소하기 위해 기억을 원자 단위로 분해하고, 계층적으로 검색하고, 시간에 따라 자연스럽게 망각하는 시스템을 설계했다. 인간이 망각의 동물인 것처럼, 이 시스템은 "적절한 망각"을 포함한 기억을 지향한다.

---

기억은 지능의 전제가 아니다. 기억은 지능의 조건이다. 체스를 두는 방법을 알아도, 어제 진 게임을 기억하지 못하면 같은 수를 또 둔다. 모든 언어를 구사해도, 어제 나눈 대화를 기억하지 못하면 매번 처음 만나는 사람이 된다. 수십억 개의 파라미터로 세상 모든 지식을 담아도, 당신과 함께한 어제를 기억하지 못하면 낯선 박식가일 뿐이다.

기억이 있어야 관계가 있다. 관계가 있어야 신뢰가 있다.

기억은 사라지지 않는다. 다만 cold tier로 내려갈 뿐이다. 그리고 충분히 오래 방치된 cold 파편은 다음 consolidate 사이클에서 소멸한다. 이것은 설계이지 버그가 아니다. 쓸모없어진 기억은 자리를 비워야 한다. 아우구스티누스의 궁전에도 창고 정리는 필요하다.

멍청한 걸로 유명한 금붕어새기도 몇 달을 기억한다.

이제 당신의 AI도 그렇다.

</details>

## License

Apache 2.0

---

<p align="center">
  Made by <a href="mailto:jinho.von.choi@nerdvana.kr">Jinho Choi</a> &nbsp;|&nbsp;
  <a href="https://buymeacoffee.com/jinho.von.choi">Buy me a coffee</a>
</p>
