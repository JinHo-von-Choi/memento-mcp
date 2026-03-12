# Integration Test CI Isolation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tests/integration/ 파일들이 실제 PostgreSQL DB 없이도 CI에서 실행 가능하도록, DB 의존 테스트와 비의존 테스트를 분리하고 GitHub Actions 워크플로우를 구성한다.

**Architecture:** integration 테스트를 두 계층으로 분리. (1) DB 없이 실행 가능한 contract 테스트 → `tests/integration/` 유지. (2) 실제 DB가 필요한 end-to-end 테스트 → `tests/e2e/`로 이동. GitHub Actions에서 PostgreSQL service container를 사용해 e2e 테스트를 실행한다. package.json에 `test:e2e` 스크립트 추가.

**Tech Stack:** Node.js node:test, GitHub Actions, PostgreSQL 15 (service container), docker-compose (로컬 개발용)

---

## Chunk 1: 현재 integration 테스트 분류

### Task 1: 기존 integration 테스트 DB 의존성 감사

**Files:**
- Read: `tests/integration/temporal.test.js`
- Read: `tests/integration/pipeline-overhaul.test.js`

- [ ] **Step 1: 각 테스트 파일의 DB 의존 여부 파악**

```bash
grep -n "getPrimaryPool\|pg\|DATABASE_URL\|INSERT\|SELECT\|pg.Pool\|connect" \
  tests/integration/temporal.test.js \
  tests/integration/pipeline-overhaul.test.js
```

DB Pool/쿼리를 직접 사용하는 테스트 = e2e 대상.
임포트 시 부작용만 있는 테스트 = contract 테스트로 남길 수 있음.

- [ ] **Step 2: 분류 결과 문서화**

`docs/superpowers/plans/integration-audit.md` 에 각 테스트 케이스별 분류 기록:

```markdown
## temporal.test.js
- searchAsOf: DB 직접 쿼리 → e2e
- valid_from/valid_to 컬럼 존재 확인: DB 직접 쿼리 → e2e

## pipeline-overhaul.test.js
- ...
```

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/plans/integration-audit.md
git commit -m "docs: integration 테스트 DB 의존성 감사 결과 기록"
```

---

## Chunk 2: 테스트 디렉토리 구조 재편

### Task 2: tests/e2e/ 디렉토리 생성 및 DB 의존 테스트 이동

**Files:**
- Create: `tests/e2e/` (디렉토리)
- Move: `tests/integration/temporal.test.js` → `tests/e2e/temporal.test.js` (DB 의존 시)
- Move: `tests/integration/pipeline-overhaul.test.js` → `tests/e2e/pipeline-overhaul.test.js` (DB 의존 시)
- Modify: `package.json`

- [ ] **Step 1: tests/e2e/ 디렉토리 생성**

```bash
mkdir -p tests/e2e
```

- [ ] **Step 2: DB 의존 파일 이동**

감사 결과에 따라 이동. 전부 DB 의존이면:

```bash
mv tests/integration/temporal.test.js tests/e2e/
mv tests/integration/pipeline-overhaul.test.js tests/e2e/
```

- [ ] **Step 3: package.json scripts 수정**

```json
"test:integration": "node --test tests/integration/*.test.js",
"test:e2e":         "node --test tests/e2e/*.test.js"
```

`tests/integration/`이 비어있게 되면 스크립트를 `test:e2e`로만 남기고 `test:integration`은 제거하거나 contract 테스트용으로 예약.

- [ ] **Step 4: 로컬에서 e2e 실행 확인 (DB 있는 환경)**

```bash
npm run test:e2e 2>&1 | tail -10
```

- [ ] **Step 5: 커밋**

```bash
git add tests/e2e/ package.json
git commit -m "refactor: DB 의존 integration 테스트를 tests/e2e/로 이동"
```

---

## Chunk 3: 로컬 개발용 docker-compose 설정

### Task 3: docker-compose.test.yml 생성

e2e 테스트를 로컬에서 재현 가능하게 만드는 docker-compose 파일.

**Files:**
- Create: `docker-compose.test.yml`
- Create: `scripts/run-e2e-tests.sh`

- [ ] **Step 1: docker-compose.test.yml 생성**

```yaml
# docker-compose.test.yml
services:
  postgres-test:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_DB:       memento_test
      POSTGRES_USER:     memento
      POSTGRES_PASSWORD: memento_test
    ports:
      - "35433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U memento -d memento_test"]
      interval: 2s
      timeout: 5s
      retries: 10
```

- [ ] **Step 2: .env.test 템플릿 생성**

```bash
# .env.test (커밋 가능한 테스트 전용 환경변수 템플릿)
POSTGRES_HOST=localhost
POSTGRES_PORT=35433
POSTGRES_DB=memento_test
POSTGRES_USER=memento
POSTGRES_PASSWORD=memento_test
REDIS_ENABLED=false
EMBEDDING_ENABLED=false
MEMENTO_ACCESS_KEY=test-key-local
```

- [ ] **Step 3: scripts/run-e2e-tests.sh 생성**

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[e2e] PostgreSQL 컨테이너 기동..."
docker compose -f docker-compose.test.yml up -d postgres-test

echo "[e2e] 헬스체크 대기..."
docker compose -f docker-compose.test.yml exec postgres-test \
  pg_isready -U memento -d memento_test

echo "[e2e] 마이그레이션 실행..."
node --env-file=.env.test lib/memory/migrate.js 2>/dev/null || \
  psql postgresql://memento:memento_test@localhost:35433/memento_test \
    -f lib/memory/migration-001-temporal.sql \
    -f lib/memory/migration-002-decay.sql

echo "[e2e] 테스트 실행..."
node --env-file=.env.test --test tests/e2e/*.test.js

echo "[e2e] 컨테이너 정리..."
docker compose -f docker-compose.test.yml down
```

```bash
chmod +x scripts/run-e2e-tests.sh
```

- [ ] **Step 4: package.json에 e2e 스크립트 추가**

```json
"test:e2e:local": "bash scripts/run-e2e-tests.sh"
```

- [ ] **Step 5: 실행 테스트**

```bash
npm run test:e2e:local 2>&1 | tail -15
```

- [ ] **Step 6: .gitignore에 .env.test.local 추가 (실제 크리덴셜 보호)**

```bash
echo ".env.test.local" >> .gitignore
```

- [ ] **Step 7: 커밋**

```bash
git add docker-compose.test.yml .env.test scripts/run-e2e-tests.sh .gitignore package.json
git commit -m "feat: e2e 테스트용 docker-compose + 로컬 실행 스크립트 추가"
```

---

## Chunk 4: GitHub Actions 워크플로우

### Task 4: .github/workflows/test.yml 생성

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: .github/workflows/ 디렉토리 생성**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: .github/workflows/test.yml 생성**

```yaml
name: Tests

on:
  push:
    branches: [main, "feat/**"]
  pull_request:
    branches: [main]

jobs:
  unit:
    name: Unit Tests (no DB)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test
        name: Jest tests
      - run: npm run test:unit
        name: node:test unit tests

  e2e:
    name: E2E Tests (with DB)
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg15
        env:
          POSTGRES_DB:       memento_test
          POSTGRES_USER:     memento
          POSTGRES_PASSWORD: memento_test
        ports:
          - 35433:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 2s
          --health-timeout 5s
          --health-retries 15
    env:
      POSTGRES_HOST:     localhost
      POSTGRES_PORT:     35433
      POSTGRES_DB:       memento_test
      POSTGRES_USER:     memento
      POSTGRES_PASSWORD: memento_test
      REDIS_ENABLED:     "false"
      EMBEDDING_ENABLED: "false"
      MEMENTO_ACCESS_KEY: ci-test-key
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - name: Run migrations
        run: |
          for f in lib/memory/migration-*.sql; do
            psql postgresql://memento:memento_test@localhost:35433/memento_test -f "$f"
          done
      - run: npm run test:e2e
        name: E2E tests
```

- [ ] **Step 3: 로컬에서 act로 워크플로우 검증 (선택)**

```bash
# act가 설치된 경우:
act -j unit --dry-run
```

- [ ] **Step 4: 커밋**

```bash
git add .github/workflows/test.yml
git commit -m "ci: GitHub Actions 워크플로우 추가 (unit + e2e 분리)"
```

---

## Chunk 5: README 업데이트

### Task 5: 테스트 실행 방법 문서화

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.md 테스트 섹션 추가/수정**

기존 테스트 설명 위치를 찾아 다음 내용으로 교체:

```markdown
## 테스트

### 단위 테스트 (DB 불필요)

\`\`\`bash
npm test          # Jest — tests/*.test.js
npm run test:unit # node:test — tests/unit/*.test.js
\`\`\`

### E2E 테스트 (PostgreSQL 필요)

로컬 Docker 환경:
\`\`\`bash
npm run test:e2e:local
\`\`\`

기존 DB 연결 사용:
\`\`\`bash
npm run test:e2e   # .env 또는 환경변수에 POSTGRES_* 설정 필요
\`\`\`
```

- [ ] **Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: 테스트 실행 방법 업데이트 (unit/e2e 분리)"
```

---

## 예상 결과

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| CI에서 DB 없이 실행 가능한 테스트 | Jest 4개만 | Jest + unit 66개 |
| DB 필요 테스트 실행 방법 | 없음 | `npm run test:e2e:local` |
| GitHub Actions | 없음 | unit job + e2e job (PostgreSQL service) |
| 로컬 재현성 | DB 직접 설정 필요 | `docker compose -f docker-compose.test.yml up` |

**최종 검증:**
```bash
npm test && npm run test:unit  # DB 없이 통과
npm run test:e2e:local         # Docker로 e2e 통과
```
