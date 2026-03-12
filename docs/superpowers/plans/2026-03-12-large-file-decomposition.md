# Large File Decomposition Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5,019줄에 달하는 5개 대형 파일을 단일 책임 단위로 분해하여 유지보수 난도와 회귀 리스크를 낮춘다.

**Architecture:** 외부 인터페이스(export 시그니처)를 일절 변경하지 않는 리팩터링. 각 파일에서 독립적으로 테스트 가능한 책임 단위를 추출하고, 원본 파일은 re-export barrel로 남겨 기존 import를 깨지 않는다. 기능 추가 없음.

**Tech Stack:** Node.js ESM, node:test, Jest (기존 테스트 러너 두 개 병존)

**작업 순서 원칙:**
- 각 Task는 독립 커밋. 실패 시 해당 커밋만 revert 가능하도록 원자적으로 구성.
- 분해 전 → 기존 테스트 통과 확인 → 분해 → 동일 테스트 재통과 확인 순서 엄수.
- 새 파일은 기존 파일에서 코드를 이동(move)하는 것이지 복사(copy)가 아님. 원본에서 삭제 확인.

---

## Chunk 1: server.js 분해 (935줄 → 3개 파일)

### 현재 server.js 책임 분석

| 책임 | 라인 범위 | 추출 대상 |
|------|-----------|-----------|
| HTTP 서버 설정 + 기동 + 종료 | 1~100, 860~935 | server.js 유지 |
| Rate limiter 인스턴스 + 메트릭 주기 작업 | 82~92 | server.js 유지 |
| MCP 요청 라우팅 (POST /mcp, GET /mcp 등) | 100~860 | lib/http-handlers.js 추출 |
| 주기 작업 스케줄러 (consolidate, backfill 등) | ~200줄 분산 | lib/scheduler.js 추출 |

### Task 1: lib/http-handlers.js 추출

**Files:**
- Create: `lib/http-handlers.js`
- Modify: `server.js`
- Test: `npm test` (기존 Jest 4개 스위트, 회귀 확인)

- [ ] **Step 1: 기존 테스트 통과 베이스라인 기록**

```bash
npm test 2>&1 | tail -5
npm run test:unit 2>&1 | tail -5
```

예상 출력: Jest 4/4, node:test 66/66

- [ ] **Step 2: server.js에서 HTTP 핸들러 함수 범위 식별**

```bash
grep -n "^async function\|^function\|app\.post\|app\.get\|app\.delete\|app\.options" server.js
```

MCP 엔드포인트 핸들러(handleMcpPost, handleMcpGet, handleMcpDelete 등)를 목록화한다.

- [ ] **Step 3: lib/http-handlers.js 생성**

server.js에서 HTTP 핸들러 함수 본체를 이동. 의존하는 import는 lib/http-handlers.js 상단에 명시.

```js
// lib/http-handlers.js
import { ... } from "./sessions.js";
import { ... } from "./jsonrpc.js";
// ... (server.js에서 핸들러가 사용하는 import만 가져옴)

export async function handleMcpPost(req, res) { /* 이동 */ }
export async function handleMcpGet(req, res)  { /* 이동 */ }
// ...
```

- [ ] **Step 4: server.js에서 핸들러 import 및 등록으로 교체**

```js
import { handleMcpPost, handleMcpGet, handleMcpDelete } from "./lib/http-handlers.js";

app.post("/mcp", handleMcpPost);
app.get("/mcp",  handleMcpGet);
// ...
```

- [ ] **Step 5: 테스트 재실행으로 회귀 없음 확인**

```bash
npm test && npm run test:unit
```

예상: 동일 통과 수

- [ ] **Step 6: 커밋**

```bash
git add lib/http-handlers.js server.js
git commit -m "refactor: server.js HTTP 핸들러를 lib/http-handlers.js로 분리"
```

---

### Task 2: lib/scheduler.js 추출

**Files:**
- Create: `lib/scheduler.js`
- Modify: `server.js`

- [ ] **Step 1: server.js에서 setInterval/setTimeout 기반 주기 작업 목록화**

```bash
grep -n "setInterval\|setTimeout\|Consolidate\|EmbeddingBackfill\|sessionCleanup\|metricsUpdate\|accessStats" server.js
```

- [ ] **Step 2: lib/scheduler.js 생성**

각 주기 작업을 함수로 묶어 export:

```js
// lib/scheduler.js
export function startSchedulers({ embeddingWorker, memoryManager, logger }) {
  // 세션 정리, 메트릭, 임베딩 백필, 컨솔리데이션 등
}
```

- [ ] **Step 3: server.js에서 호출로 교체**

```js
import { startSchedulers } from "./lib/scheduler.js";
// gracefulShutdown 이후:
startSchedulers({ embeddingWorker, memoryManager, logger });
```

- [ ] **Step 4: 테스트 재실행**

```bash
npm test && npm run test:unit
```

- [ ] **Step 5: 커밋**

```bash
git add lib/scheduler.js server.js
git commit -m "refactor: server.js 주기 작업을 lib/scheduler.js로 분리"
```

---

## Chunk 2: MemoryManager.js 분해 (1,250줄 → 3개 파일)

### 현재 MemoryManager.js 책임 분석

| 책임 | 메서드 | 추출 대상 |
|------|--------|-----------|
| 핵심 CRUD (remember/recall/forget/amend) | remember, recall, forget, amend | MemoryManager.js 유지 |
| 세션 반성/컨텍스트 | reflect, context | MemoryManager.js 유지 |
| 내부 충돌 감지 + 자동 링크 | _detectConflicts, _autoLinkOnRemember, _supersede | lib/memory/ConflictResolver.js |
| 세션 파편 통합 + 링크 + 사이클 감지 | _consolidateSessionFragments, _autoLinkSessionFragments, _wouldCreateCycle | lib/memory/SessionLinker.js |
| 통계/피드백 저장 | stats, toolFeedback, _saveTaskFeedback | MemoryManager.js 유지 (작음) |

### Task 3: lib/memory/ConflictResolver.js 추출

**Files:**
- Create: `lib/memory/ConflictResolver.js`
- Modify: `lib/memory/MemoryManager.js`

- [ ] **Step 1: 베이스라인 테스트 통과 확인**

```bash
npm test && npm run test:unit
```

- [ ] **Step 2: 추출 대상 메서드 경계 확인**

```bash
sed -n '169,258p' lib/memory/MemoryManager.js   # _detectConflicts
sed -n '214,228p' lib/memory/MemoryManager.js   # _autoLinkOnRemember
sed -n '229,258p' lib/memory/MemoryManager.js   # _supersede
```

- [ ] **Step 3: lib/memory/ConflictResolver.js 생성**

```js
// lib/memory/ConflictResolver.js
import { FragmentStore }  from "./FragmentStore.js";
import { FragmentSearch } from "./FragmentSearch.js";
import { logWarn }        from "../logger.js";

export class ConflictResolver {
  constructor(store, search) {
    this.store  = store;
    this.search = search;
  }

  async detectConflicts(content, topic, newId, agentId, keyId) { /* 이동 */ }
  async autoLinkOnRemember(newFragment, agentId)               { /* 이동 */ }
  async supersede(oldId, newId, agentId)                       { /* 이동 */ }
}
```

- [ ] **Step 4: MemoryManager.js에서 위임으로 교체**

```js
import { ConflictResolver } from "./ConflictResolver.js";

// constructor에 추가:
this.conflictResolver = new ConflictResolver(this.store, this.search);

// 기존 메서드 호출부:
const conflicts = await this.conflictResolver.detectConflicts(...);
```

원본 메서드 본체는 MemoryManager.js에서 삭제.

- [ ] **Step 5: 테스트 재실행**

```bash
npm test && npm run test:unit
```

- [ ] **Step 6: 커밋**

```bash
git add lib/memory/ConflictResolver.js lib/memory/MemoryManager.js
git commit -m "refactor: MemoryManager.js 충돌 감지/자동 링크를 ConflictResolver.js로 분리"
```

---

### Task 4: lib/memory/SessionLinker.js 추출

**Files:**
- Create: `lib/memory/SessionLinker.js`
- Modify: `lib/memory/MemoryManager.js`

- [ ] **Step 1: 추출 대상 메서드 경계 확인**

```bash
sed -n '1078,1195p' lib/memory/MemoryManager.js  # _consolidateSessionFragments, _autoLinkSessionFragments, _wouldCreateCycle
```

- [ ] **Step 2: lib/memory/SessionLinker.js 생성**

```js
// lib/memory/SessionLinker.js
export class SessionLinker {
  constructor(store) {
    this.store = store;
  }

  async consolidateSessionFragments(sessionId, agentId, keyId) { /* 이동 */ }
  async autoLinkSessionFragments(fragments, agentId)           { /* 이동 */ }
  async wouldCreateCycle(fromId, toId, agentId)               { /* 이동 */ }
}
```

- [ ] **Step 3: MemoryManager.js에서 위임으로 교체**

```js
import { SessionLinker } from "./SessionLinker.js";

this.sessionLinker = new SessionLinker(this.store);

// reflect() 내부:
await this.sessionLinker.consolidateSessionFragments(sessionId, agentId, keyId);
```

- [ ] **Step 4: 테스트 재실행**

```bash
npm test && npm run test:unit
```

- [ ] **Step 5: 커밋**

```bash
git add lib/memory/SessionLinker.js lib/memory/MemoryManager.js
git commit -m "refactor: MemoryManager.js 세션 링킹을 SessionLinker.js로 분리"
```

---

## Chunk 3: FragmentStore.js 분해 (941줄 → 2개 파일)

### 현재 FragmentStore.js 책임 분석

| 책임 | 메서드 | 추출 대상 |
|------|--------|-----------|
| 파편 CRUD + 버전 관리 | insert, getById, getByIds, update, delete, archiveVersion | FragmentStore.js 유지 |
| 키워드/토픽/시맨틱 검색 | searchByKeywords, searchByTopic, searchBySemantic, searchAsOf | FragmentStore.js 유지 (SearchMethods와 중첩되어 분리 비용 高) |
| 링크 관리 | createLink, getLinkedFragments, getLinkedIds, isReachable | lib/memory/LinkStore.js |
| GC/감쇠/TTL 전환 | deleteExpired, decayImportance, transitionTTL | lib/memory/FragmentGC.js |
| RCA 체인 | getRCAChain | lib/memory/LinkStore.js (링크 관련) |

### Task 5: lib/memory/LinkStore.js 추출

**Files:**
- Create: `lib/memory/LinkStore.js`
- Modify: `lib/memory/FragmentStore.js`

- [ ] **Step 1: 링크 관련 메서드 범위 확인**

```bash
sed -n '560,693p' lib/memory/FragmentStore.js   # createLink ~ isReachable
sed -n '847,901p' lib/memory/FragmentStore.js   # getRCAChain
```

- [ ] **Step 2: lib/memory/LinkStore.js 생성**

```js
// lib/memory/LinkStore.js
import { getPrimaryPool } from "../tools/db.js";
import { SCHEMA }        from "../../config/memory.js";

export class LinkStore {
  async createLink(fromId, toId, relationType, agentId)          { /* 이동 */ }
  async getLinkedFragments(fromIds, relationType, agentId)       { /* 이동 */ }
  async getLinkedIds(fragmentId, agentId)                        { /* 이동 */ }
  async isReachable(startId, targetId, agentId)                  { /* 이동 */ }
  async getRCAChain(startId, agentId)                            { /* 이동 */ }
}
```

- [ ] **Step 3: FragmentStore.js에서 위임으로 교체**

```js
import { LinkStore } from "./LinkStore.js";

// constructor에 추가:
this.links = new LinkStore();

// 기존 호출:
async createLink(...args) { return this.links.createLink(...args); }
```

- [ ] **Step 4: 테스트 재실행**

```bash
npm test && npm run test:unit
```

- [ ] **Step 5: 커밋**

```bash
git add lib/memory/LinkStore.js lib/memory/FragmentStore.js
git commit -m "refactor: FragmentStore.js 링크 관리를 LinkStore.js로 분리"
```

---

### Task 6: lib/memory/FragmentGC.js 추출

**Files:**
- Create: `lib/memory/FragmentGC.js`
- Modify: `lib/memory/FragmentStore.js`

- [ ] **Step 1: GC 메서드 범위 확인**

```bash
sed -n '694,845p' lib/memory/FragmentStore.js   # deleteExpired, decayImportance, transitionTTL
```

- [ ] **Step 2: lib/memory/FragmentGC.js 생성**

```js
// lib/memory/FragmentGC.js
export class FragmentGC {
  async deleteExpired()      { /* 이동 */ }
  async decayImportance()    { /* 이동 */ }
  async transitionTTL()      { /* 이동 */ }
}
```

- [ ] **Step 3: FragmentStore.js에서 위임으로 교체**

```js
import { FragmentGC } from "./FragmentGC.js";

this.gc = new FragmentGC();

async deleteExpired()   { return this.gc.deleteExpired(); }
async decayImportance() { return this.gc.decayImportance(); }
async transitionTTL()   { return this.gc.transitionTTL(); }
```

- [ ] **Step 4: 테스트 재실행**

```bash
npm test && npm run test:unit
```

- [ ] **Step 5: 커밋**

```bash
git add lib/memory/FragmentGC.js lib/memory/FragmentStore.js
git commit -m "refactor: FragmentStore.js GC/감쇠를 FragmentGC.js로 분리"
```

---

## Chunk 4: MemoryConsolidator.js 분해 (1,151줄 → 2개 파일)

### 현재 책임 분석

| 책임 | 메서드 | 추출 대상 |
|------|--------|-----------|
| 파이프라인 진입점 + 중복/전환/유틸 | consolidate, _mergeDuplicates, _transitionWithCount, _updateUtilityScores, _promoteAnchors | MemoryConsolidator.js 유지 |
| 모순/대체 감지 (NLI/Gemini 외부 호출) | _detectContradictions, _resolveContradiction, _detectSupersessions, _askGeminiSupersession, _askGeminiContradiction, _flagPotentialContradiction, _processPendingContradictions | lib/memory/ContradictionDetector.js |
| GC + 보고 | _collectStaleFragments, _purgeStaleReflections, _splitLongFragments, _calibrateByFeedback, _generateFeedbackReport | lib/memory/ConsolidatorGC.js |

### Task 7: lib/memory/ContradictionDetector.js 추출

**Files:**
- Create: `lib/memory/ContradictionDetector.js`
- Modify: `lib/memory/MemoryConsolidator.js`

- [ ] **Step 1: 추출 대상 범위 확인**

```bash
sed -n '272,681p' lib/memory/MemoryConsolidator.js   # _detectContradictions ~ _updateContradictionTimestamp
```

- [ ] **Step 2: lib/memory/ContradictionDetector.js 생성**

```js
// lib/memory/ContradictionDetector.js
import { NLIClassifier } from "./NLIClassifier.js";
import { logWarn }       from "../logger.js";

export class ContradictionDetector {
  constructor(store, redisClient) {
    this.store       = store;
    this.redisClient = redisClient;
    this.nli         = new NLIClassifier();
  }

  async detectContradictions()                          { /* 이동 */ }
  async resolveContradiction(newFrag, candidate, reasoning) { /* 이동 */ }
  async detectSupersessions()                           { /* 이동 */ }
  // ... 내부 헬퍼 메서드
}
```

- [ ] **Step 3: MemoryConsolidator.js에서 위임으로 교체**

```js
import { ContradictionDetector } from "./ContradictionDetector.js";

this.contradictionDetector = new ContradictionDetector(this.store, redisClient);

// consolidate() 파이프라인 내:
await this.contradictionDetector.detectContradictions();
await this.contradictionDetector.detectSupersessions();
```

- [ ] **Step 4: 기존 unit 테스트 통과 확인 (detect-supersessions.test.js 포함)**

```bash
npm run test:unit 2>&1 | grep -E "pass|fail|supersession"
```

- [ ] **Step 5: 커밋**

```bash
git add lib/memory/ContradictionDetector.js lib/memory/MemoryConsolidator.js
git commit -m "refactor: MemoryConsolidator.js 모순 감지를 ContradictionDetector.js로 분리"
```

---

### Task 8: lib/memory/ConsolidatorGC.js 추출

**Files:**
- Create: `lib/memory/ConsolidatorGC.js`
- Modify: `lib/memory/MemoryConsolidator.js`

- [ ] **Step 1: GC 메서드 범위 확인**

```bash
sed -n '847,1070p' lib/memory/MemoryConsolidator.js   # _collectStaleFragments ~ _calibrateByFeedback
```

- [ ] **Step 2: lib/memory/ConsolidatorGC.js 생성**

```js
// lib/memory/ConsolidatorGC.js
export class ConsolidatorGC {
  constructor(store) {
    this.store = store;
  }

  async collectStaleFragments()   { /* 이동 */ }
  async purgeStaleReflections()   { /* 이동 */ }
  async splitLongFragments()      { /* 이동 */ }
  async calibrateByFeedback()     { /* 이동 */ }
  async generateFeedbackReport()  { /* 이동 */ }
}
```

- [ ] **Step 3: MemoryConsolidator.js에서 위임으로 교체**

- [ ] **Step 4: 테스트 재실행**

```bash
npm test && npm run test:unit
```

- [ ] **Step 5: 커밋**

```bash
git add lib/memory/ConsolidatorGC.js lib/memory/MemoryConsolidator.js
git commit -m "refactor: MemoryConsolidator.js GC 로직을 ConsolidatorGC.js로 분리"
```

---

## Chunk 5: lib/tools/memory.js 분해 (742줄 → 2개 파일)

### 책임 분석

| 책임 | 추출 대상 |
|------|-----------|
| 도구 스키마 정의 (inputSchema, description) | lib/tools/memory-schemas.js |
| 도구 핸들러 구현 (tool_remember, tool_recall 등) | lib/tools/memory.js 유지 |

### Task 9: lib/tools/memory-schemas.js 추출

**Files:**
- Create: `lib/tools/memory-schemas.js`
- Modify: `lib/tools/memory.js`

- [ ] **Step 1: 스키마 정의 범위 확인**

```bash
grep -n "inputSchema\|description.*{" lib/tools/memory.js | head -20
```

- [ ] **Step 2: lib/tools/memory-schemas.js 생성**

```js
// lib/tools/memory-schemas.js
export const rememberSchema    = { name: "remember",    description: "...", inputSchema: { ... } };
export const recallSchema      = { name: "recall",      description: "...", inputSchema: { ... } };
// ... 12개 도구 스키마
```

- [ ] **Step 3: lib/tools/memory.js에서 import로 교체**

```js
import { rememberSchema, recallSchema, ... } from "./memory-schemas.js";
```

- [ ] **Step 4: 테스트 재실행**

```bash
npm test && npm run test:unit
```

- [ ] **Step 5: 커밋**

```bash
git add lib/tools/memory-schemas.js lib/tools/memory.js
git commit -m "refactor: memory.js 도구 스키마를 memory-schemas.js로 분리"
```

---

## 예상 결과

| 파일 | 분해 전 | 분해 후 |
|------|---------|---------|
| server.js | 935줄 | ~300줄 |
| lib/http-handlers.js | — | ~550줄 |
| lib/scheduler.js | — | ~80줄 |
| lib/memory/MemoryManager.js | 1,250줄 | ~700줄 |
| lib/memory/ConflictResolver.js | — | ~150줄 |
| lib/memory/SessionLinker.js | — | ~120줄 |
| lib/memory/FragmentStore.js | 941줄 | ~550줄 |
| lib/memory/LinkStore.js | — | ~220줄 |
| lib/memory/FragmentGC.js | — | ~170줄 |
| lib/memory/MemoryConsolidator.js | 1,151줄 | ~350줄 |
| lib/memory/ContradictionDetector.js | — | ~450줄 |
| lib/memory/ConsolidatorGC.js | — | ~250줄 |
| lib/tools/memory.js | 742줄 | ~500줄 |
| lib/tools/memory-schemas.js | — | ~240줄 |

**검증:** 모든 Task 완료 후 `npm test && npm run test:unit` 전체 통과, `npm run lint` 에러 0개.
