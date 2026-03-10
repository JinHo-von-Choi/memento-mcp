# 설치 가이드

## 빠른 시작 (대화형 설치 스크립트)

```bash
bash setup.sh
```

.env 생성, npm install, DB 스키마 적용까지 단계별로 안내한다.

---

## 수동 설치

## 의존성 설치

```bash
npm install

# (선택) CUDA 11 환경에서 설치 오류 발생 시 CPU 전용으로 설치
# npm install --onnxruntime-node-install-cuda=skip
```

### 주의사항: ONNX Runtime 및 CUDA

CUDA 11이 설치된 시스템에서 `@huggingface/transformers`의 의존성인 `onnxruntime-node`가 GPU 바인딩을 시도하다 설치에 실패할 수 있습니다. 이 프로젝트는 CPU 전용으로 최적화되어 있으므로, 설치 시 `--onnxruntime-node-install-cuda=skip` 플래그를 사용하면 문제 없이 설치됩니다.

## PostgreSQL 스키마 적용

```bash
# 신규 설치
psql -U $POSTGRES_USER -d $POSTGRES_DB -f lib/memory/memory-schema.sql
```

## 업그레이드 (기존 설치)

마이그레이션을 순서대로 실행한다.

```bash
psql $DATABASE_URL -f lib/memory/migration-001-temporal.sql      # Temporal 컬럼 추가
psql $DATABASE_URL -f lib/memory/migration-002-decay.sql         # last_decay_at 컬럼 추가
psql $DATABASE_URL -f lib/memory/migration-003-api-keys.sql      # API 키 관리 테이블 추가
psql $DATABASE_URL -f lib/memory/migration-004-key-isolation.sql # fragments.key_id 격리 컬럼 추가
psql $DATABASE_URL -f lib/memory/migration-005-gc-columns.sql    # GC 정책 인덱스 추가
psql $DATABASE_URL -f lib/memory/migration-006-superseded-by-constraint.sql # fragment_links CHECK에 superseded_by 추가
psql $DATABASE_URL -f lib/memory/migration-007-link-weight.sql   # fragment_links.weight 컬럼 추가
psql $DATABASE_URL -f lib/memory/migration-008-morpheme-dict.sql # 형태소 사전 테이블 추가
psql $DATABASE_URL -f lib/memory/migration-009-co-retrieved.sql  # co_retrieved 링크 타입 추가
psql $DATABASE_URL -f lib/memory/migration-010-ema-activation.sql # EMA 활성화 컬럼 추가
```

> **v1.1.0 이전에서 업그레이드하는 경우**: migration-006 미실행 시 `amend`, `memory_consolidate`, GraphLinker 자동 관계 생성에서 DB 제약 에러가 발생한다(`superseded_by` INSERT 실패). 기존 DB를 유지하며 업그레이드할 때 반드시 실행해야 한다.

> **migration-009, 010**: co_retrieved 링크 타입이 없으면 Hebbian 링킹이 DB 제약 에러로 조용히 실패하고, ema_activation 컬럼이 없으면 incrementAccess SQL 오류가 발생한다. 반드시 실행 후 서버를 시작해야 한다.

```bash
# 기본 임베딩(1536차원) 사용 시: migration-007 불필요
# 2000차원 초과 모델(Gemini gemini-embedding-001 등) 사용 시:
# EMBEDDING_DIMENSIONS=3072 DATABASE_URL=$DATABASE_URL node lib/memory/migration-007-flexible-embedding-dims.js

DATABASE_URL=$DATABASE_URL node lib/memory/normalize-vectors.js  # 임베딩 L2 정규화 (1회)

# 기존 파편 임베딩 백필 (임베딩 API 키 필요, 1회성)
npm run backfill:embeddings
```

## 환경 변수 설정

```bash
cp .env.example .env
# .env 파일에서 DATABASE_URL, MEMENTO_ACCESS_KEY 등 필수 값 입력
```

환경 변수 전체 목록은 [README.md — 환경 변수](README.md#환경-변수) 참조.

## 서버 실행

```bash
node server.js
```

## Claude Code 연결

`~/.claude/settings.json` 또는 프로젝트 `.claude/settings.json`:

```json
{
  "mcpServers": {
    "memento": {
      "type": "http",
      "url": "http://localhost:57332/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MEMENTO_ACCESS_KEY"
      }
    }
  }
}
```

## 훅 기반 Context 자동 로드

memento-mcp는 `initialize` 응답의 `instructions` 필드에서 AI에게 기억 도구를 적극 사용하도록 권장하지만, 이것만으로는 세션 시작 시 과거 기억이 자동으로 주입되지 않는다. Claude Code 훅을 이용하면 AI가 매 세션마다 관련 기억을 능동적으로 불러오도록 강제할 수 있다.

**세션 시작 시 Core Memory 자동 로드** (`~/.claude/settings.json`):

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

또는 `CLAUDE.md`에 아래 지시를 추가하면 AI가 세션 시작 시 스스로 `context` 도구를 호출한다:

```markdown
## 세션 시작 규칙
- 대화 시작 시 반드시 `context` 도구를 호출하여 Core Memory와 Working Memory를 로드한다.
- 에러 해결이나 코드 작업 전에는 `recall(keywords=[관련_키워드], type="error")`로 관련 기억을 먼저 확인한다.
```

`context`는 중요도 높은 파편을 캡슐화하여 반환하므로 컨텍스트 오염 없이 핵심 정보만 주입된다. `recall`은 현재 작업과 관련된 파편을 키워드/시맨틱 검색으로 추가 로드한다. 세션 시작 훅과 `CLAUDE.md` 지시를 병행하면 AI가 처음 만나는 사람처럼 행동하는 현상이 크게 줄어든다.

외부에서 접속할 때는 nginx 리버스 프록시를 통해 노출한다. 내부 IP나 내부 포트를 외부 문서에 직접 기재하지 않는다.
