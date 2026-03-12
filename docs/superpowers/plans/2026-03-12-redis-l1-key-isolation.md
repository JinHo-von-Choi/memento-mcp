# Redis L1 API 키 격리 구현 플랜

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 멀티 에이전트(API 키) 환경에서 Redis L1 역인덱스와 Hot Cache의 크로스 테넌트 데이터 누출을 차단한다.

**Architecture:** FragmentIndex의 모든 Redis 키에 keyId 네임스페이스를 추가한다. master key(keyId=null)는 글로벌 네임스페이스(`_g`)를 사용하고, DB API key(keyId=숫자)는 `_k{keyId}` 접두어를 사용한다. FragmentSearch가 keyId를 L1 레이어까지 전파하도록 수정한다. LinkStore.getLinkedFragments에 keyId 필터를 추가한다. MemoryConsolidator는 글로벌(master-only) 작업이므로 기존 동작 유지하되 GC preview 등 조회 쿼리에 key_id IS NULL 조건을 명시한다.

**Tech Stack:** Node.js ESM, Redis (ioredis), PostgreSQL, Jest + node:test

---

## Chunk 1: FragmentIndex keyId 네임스페이스

### Task 1: FragmentIndex — 키 접두어 헬퍼 + index/deindex 수정

**Files:**
- Modify: `lib/memory/FragmentIndex.js`
- Test: `tests/unit/fragment-index-isolation.test.js`

- [ ] **Step 1: 테스트 파일 생성 (실패 테스트)**

```js
// tests/unit/fragment-index-isolation.test.js
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * FragmentIndex의 keyId 격리를 검증한다.
 * Redis를 mock하여 실제 키 패턴이 keyId를 포함하는지 확인.
 */
describe("FragmentIndex keyId isolation", () => {
  let FragmentIndex, mockRedis, capturedKeys;

  beforeEach(async () => {
    capturedKeys = [];
    mockRedis = {
      status: "ready",
      pipeline: () => {
        const cmds = [];
        const p = {
          sadd:   (key, val) => { capturedKeys.push({ cmd: "sadd",   key }); cmds.push(["sadd", key, val]); return p; },
          zadd:   (key, ...a) => { capturedKeys.push({ cmd: "zadd",   key }); cmds.push(["zadd", key, ...a]); return p; },
          expire: (key, ttl) => { capturedKeys.push({ cmd: "expire", key }); return p; },
          srem:   (key, val) => { capturedKeys.push({ cmd: "srem",   key }); return p; },
          zrem:   (key, val) => { capturedKeys.push({ cmd: "zrem",   key }); return p; },
          del:    (key)      => { capturedKeys.push({ cmd: "del",    key }); return p; },
          exec:   () => Promise.resolve(cmds.map(() => [null, 1]))
        };
        return p;
      },
      sinter:    (...keys) => { capturedKeys.push({ cmd: "sinter", keys }); return Promise.resolve([]); },
      sunion:    (...keys) => { capturedKeys.push({ cmd: "sunion", keys }); return Promise.resolve([]); },
      smembers:  (key) =>     { capturedKeys.push({ cmd: "smembers", key }); return Promise.resolve([]); },
      zrevrange: (key, s, e) => { capturedKeys.push({ cmd: "zrevrange", key }); return Promise.resolve([]); },
      setex:     (key, ttl, val) => { capturedKeys.push({ cmd: "setex", key }); return Promise.resolve(); },
      get:       (key) =>     { capturedKeys.push({ cmd: "get", key }); return Promise.resolve(null); }
    };

    // redis.js 모듈을 mock하여 mockRedis를 주입
    // 동적 import + mock.module 방식
    mock.module("../../lib/redis.js", {
      namedExports: { redisClient: mockRedis }
    });
    const mod = await import("../../lib/memory/FragmentIndex.js");
    FragmentIndex = mod.FragmentIndex;
  });

  it("index()에 keyId=5 전달 시 frag:kw:_k5: 접두어 사용", async () => {
    const idx = new FragmentIndex();
    await idx.index({ id: "f1", keywords: ["db"], topic: "test", type: "fact" }, null, 5);

    const kwKey = capturedKeys.find(c => c.cmd === "sadd" && c.key.includes("kw"));
    assert.ok(kwKey, "keyword sadd가 호출되어야 한다");
    assert.match(kwKey.key, /frag:kw:_k5:db/);
  });

  it("index()에 keyId=null 전달 시 frag:kw:_g: 접두어 사용", async () => {
    const idx = new FragmentIndex();
    await idx.index({ id: "f2", keywords: ["redis"], topic: "infra", type: "fact" }, null, null);

    const kwKey = capturedKeys.find(c => c.cmd === "sadd" && c.key.includes("kw"));
    assert.ok(kwKey);
    assert.match(kwKey.key, /frag:kw:_g:redis/);
  });

  it("searchByKeywords에 keyId 전달 시 해당 네임스페이스만 조회", async () => {
    const idx = new FragmentIndex();
    await idx.searchByKeywords(["test"], 3, 5);

    const sinterCall = capturedKeys.find(c => c.cmd === "sinter");
    assert.ok(sinterCall);
    assert.ok(sinterCall.keys[0].includes("_k5:"));
  });

  it("getRecent에 keyId 전달 시 해당 네임스페이스의 ZSET 조회", async () => {
    const idx = new FragmentIndex();
    await idx.getRecent(20, 5);

    const zCall = capturedKeys.find(c => c.cmd === "zrevrange");
    assert.ok(zCall);
    assert.match(zCall.key, /frag:recent:_k5/);
  });

  it("cacheFragment에 keyId 전달 시 네임스페이스 포함 키 사용", async () => {
    const idx = new FragmentIndex();
    await idx.cacheFragment("f1", { id: "f1", content: "test" }, 5);

    const setexCall = capturedKeys.find(c => c.cmd === "setex");
    assert.ok(setexCall);
    assert.match(setexCall.key, /frag:hot:_k5:f1/);
  });

  it("getCachedFragment에 keyId 전달 시 해당 네임스페이스에서만 조회", async () => {
    const idx = new FragmentIndex();
    await idx.getCachedFragment("f1", 5);

    const getCall = capturedKeys.find(c => c.cmd === "get");
    assert.ok(getCall);
    assert.match(getCall.key, /frag:hot:_k5:f1/);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
node --test tests/unit/fragment-index-isolation.test.js
```

예상: index()가 keyId 파라미터를 받지 않으므로 실패

- [ ] **Step 3: FragmentIndex.js 수정 — keyId 네임스페이스 적용**

`lib/memory/FragmentIndex.js` 수정 내용:

```js
// 파일 상단에 헬퍼 추가 (12행 부근, 상수 선언 직후)
/**
 * keyId에 따른 Redis 키 네임스페이스 접두어를 반환한다.
 * - null (master key): "_g" (global)
 * - 숫자 (DB API key): "_k{keyId}"
 */
function keyNs(keyId) {
  return keyId == null ? "_g" : `_k${keyId}`;
}
```

모든 메서드 시그니처에 `keyId = null` 파라미터를 추가하고, Redis 키 패턴을 변경:

| 메서드 | 기존 키 패턴 | 변경 키 패턴 |
|--------|-------------|-------------|
| index() | `frag:kw:{keyword}` | `frag:kw:{ns}:{keyword}` |
| index() | `frag:tp:{topic}` | `frag:tp:{ns}:{topic}` |
| index() | `frag:ty:{type}` | `frag:ty:{ns}:{type}` |
| index() | `frag:recent` | `frag:recent:{ns}` |
| deindex() | 동일 패턴 | 동일 패턴에 ns 추가 |
| searchByKeywords() | `frag:kw:{keyword}` | `frag:kw:{ns}:{keyword}` |
| searchByTopic() | `frag:tp:{topic}` | `frag:tp:{ns}:{topic}` |
| searchByType() | `frag:ty:{type}` | `frag:ty:{ns}:{type}` |
| getRecent() | `frag:recent` | `frag:recent:{ns}` |
| cacheFragment() | `frag:hot:{id}` | `frag:hot:{ns}:{id}` |
| getCachedFragment() | `frag:hot:{id}` | `frag:hot:{ns}:{id}` |
| pruneKeywordIndexes() | `frag:kw:*` | `frag:kw:*` (전체 정리, 변경 없음) |

구체적 변경:

**index()** — 시그니처: `async index(fragment, sessionId, keyId = null)`

```js
async index(fragment, sessionId, keyId = null) {
  if (!redisClient || redisClient.status !== "ready") return;

  const ns       = keyNs(keyId);
  const pipeline = redisClient.pipeline();
  const now      = Date.now();

  for (const kw of (fragment.keywords || [])) {
    pipeline.sadd(`${KW_PREFIX}${ns}:${kw.toLowerCase()}`, fragment.id);
  }

  pipeline.sadd(`${TOPIC_PREFIX}${ns}:${fragment.topic}`, fragment.id);
  pipeline.sadd(`${TYPE_PREFIX}${ns}:${fragment.type}`, fragment.id);
  pipeline.zadd(`${RECENT_KEY}:${ns}`, now, fragment.id);

  if (sessionId) {
    pipeline.sadd(`${SESSION_PREFIX}${sessionId}`, fragment.id);
    pipeline.expire(`${SESSION_PREFIX}${sessionId}`, 86400);
  }

  await pipeline.exec().catch(err =>
    console.warn(`[FragmentIndex] index failed: ${err.message}`)
  );
}
```

**deindex()** — 시그니처: `async deindex(fragmentId, keywords, topic, type, keyId = null)`

```js
async deindex(fragmentId, keywords, topic, type, keyId = null) {
  if (!redisClient || redisClient.status !== "ready") return;

  const ns       = keyNs(keyId);
  const pipeline = redisClient.pipeline();

  for (const kw of (keywords || [])) {
    pipeline.srem(`${KW_PREFIX}${ns}:${kw.toLowerCase()}`, fragmentId);
  }

  if (topic) pipeline.srem(`${TOPIC_PREFIX}${ns}:${topic}`, fragmentId);
  if (type)  pipeline.srem(`${TYPE_PREFIX}${ns}:${type}`, fragmentId);
  pipeline.zrem(`${RECENT_KEY}:${ns}`, fragmentId);
  pipeline.del(`${HOT_PREFIX}${ns}:${fragmentId}`);

  await pipeline.exec().catch(err =>
    console.warn(`[FragmentIndex] deindex failed: ${err.message}`)
  );
}
```

**searchByKeywords()** — 시그니처: `async searchByKeywords(keywords, minResults = 3, keyId = null)`

```js
async searchByKeywords(keywords, minResults = 3, keyId = null) {
  if (!redisClient || redisClient.status !== "ready" || keywords.length === 0) {
    return [];
  }

  const ns   = keyNs(keyId);
  const keys = keywords.map(kw => `${KW_PREFIX}${ns}:${kw.toLowerCase()}`);

  let ids = await redisClient.sinter(...keys).catch(() => []);

  if (ids.length < minResults && keys.length > 1) {
    ids = await redisClient.sunion(...keys).catch(() => []);
  }

  return ids;
}
```

**searchByTopic()** — 시그니처: `async searchByTopic(topic, keyId = null)`

```js
async searchByTopic(topic, keyId = null) {
  if (!redisClient || redisClient.status !== "ready") return [];
  return redisClient.smembers(`${TOPIC_PREFIX}${keyNs(keyId)}:${topic}`).catch(() => []);
}
```

**searchByType()** — 시그니처: `async searchByType(type, keyId = null)`

```js
async searchByType(type, keyId = null) {
  if (!redisClient || redisClient.status !== "ready") return [];
  return redisClient.smembers(`${TYPE_PREFIX}${keyNs(keyId)}:${type}`).catch(() => []);
}
```

**getRecent()** — 시그니처: `async getRecent(count = 20, keyId = null)`

```js
async getRecent(count = 20, keyId = null) {
  if (!redisClient || redisClient.status !== "ready") return [];
  return redisClient.zrevrange(`${RECENT_KEY}:${keyNs(keyId)}`, 0, count - 1).catch(() => []);
}
```

**cacheFragment()** — 시그니처: `async cacheFragment(fragmentId, data, keyId = null)`

```js
async cacheFragment(fragmentId, data, keyId = null) {
  if (!redisClient || redisClient.status !== "ready") return;
  await redisClient.setex(
    `${HOT_PREFIX}${keyNs(keyId)}:${fragmentId}`,
    HOT_CACHE_TTL,
    JSON.stringify(data)
  ).catch(() => {});
}
```

**getCachedFragment()** — 시그니처: `async getCachedFragment(fragmentId, keyId = null)`

```js
async getCachedFragment(fragmentId, keyId = null) {
  if (!redisClient || redisClient.status !== "ready") return null;

  const val = await redisClient.get(`${HOT_PREFIX}${keyNs(keyId)}:${fragmentId}`).catch(() => null);
  return val ? JSON.parse(val) : null;
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
node --test tests/unit/fragment-index-isolation.test.js
```

예상: 6/6 통과

- [ ] **Step 5: 기존 테스트 회귀 확인**

```bash
npm test && npm run test:unit
```

예상: Jest 23/23, node:test 66+ 통과 (FragmentIndex를 직접 사용하는 테스트가 있다면 keyId 기본값 null로 호환)

- [ ] **Step 6: 커밋**

```bash
git add lib/memory/FragmentIndex.js tests/unit/fragment-index-isolation.test.js
git commit -m "feat: FragmentIndex Redis 키에 keyId 네임스페이스 격리 추가"
```

---

## Chunk 2: FragmentSearch keyId L1 전파

### Task 2: FragmentSearch — keyId를 _searchL1, _tryHotCache, _cacheFragments에 전파

**Files:**
- Modify: `lib/memory/FragmentSearch.js`
- Test: 기존 테스트로 회귀 확인

- [ ] **Step 1: FragmentSearch.js 수정**

변경 범위: `search()`, `_searchL1()`, `_tryHotCache()`, `_cacheFragments()` 4개 메서드.

**search()** (41행~): keyId를 _searchL1, _tryHotCache, _cacheFragments에 전달

```js
// 53~54행: _searchL1에 keyId 전달
const l1Ids  = await this._searchL1(query, keyId);

// 60행: _tryHotCache에 keyId 전달
cached = await this._tryHotCache(l1Ids, keyId);

// 125행: _cacheFragments에 keyId 전달
this._cacheFragments(clean, keyId);
```

**_searchL1()** — 시그니처: `async _searchL1(query, keyId = null)`

```js
async _searchL1(query, keyId = null) {
  const sets = [];

  if (query.keywords && query.keywords.length > 0) {
    const kwIds = await this.index.searchByKeywords(query.keywords, 3, keyId);
    if (kwIds.length > 0) sets.push(new Set(kwIds));
  }

  if (query.topic) {
    const topicIds = await this.index.searchByTopic(query.topic, keyId);
    if (topicIds.length > 0) sets.push(new Set(topicIds));
  }

  if (query.type) {
    const typeIds = await this.index.searchByType(query.type, keyId);
    if (typeIds.length > 0) sets.push(new Set(typeIds));
  }

  if (sets.length === 0) {
    return this.index.getRecent(20, keyId);
  }

  if (sets.length === 1) {
    return [...sets[0]];
  }

  return [...sets[0]].filter(id => sets.slice(1).every(s => s.has(id)));
}
```

**_tryHotCache()** — 시그니처: `async _tryHotCache(ids, keyId = null)`

```js
async _tryHotCache(ids, keyId = null) {
  const results = [];

  for (const id of ids.slice(0, 30)) {
    const cached = await this.index.getCachedFragment(id, keyId);
    if (cached && cached.content) results.push(cached);
  }

  return results;
}
```

**_cacheFragments()** — 시그니처: `async _cacheFragments(fragments, keyId = null)`

```js
async _cacheFragments(fragments, keyId = null) {
  try {
    for (const f of fragments) {
      await this.index.cacheFragment(f.id, f, keyId);
    }
  } catch { /* 무시 */ }
}
```

- [ ] **Step 2: 기존 테스트 회귀 확인**

```bash
npm test && npm run test:unit
```

예상: 전수 통과 (keyId 기본값 null로 하위 호환)

- [ ] **Step 3: 커밋**

```bash
git add lib/memory/FragmentSearch.js
git commit -m "feat: FragmentSearch L1/HotCache에 keyId 격리 전파"
```

---

## Chunk 3: FragmentStore/MemoryManager — index/deindex 호출부 keyId 전달

### Task 3: FragmentStore.insert/delete에서 FragmentIndex.index/deindex 호출 시 keyId 전달

**Files:**
- Modify: `lib/memory/FragmentStore.js`
- Test: 기존 테스트로 회귀 확인

- [ ] **Step 1: FragmentStore.js에서 index/deindex 호출부 찾기**

```bash
grep -n "this.index\.\|new FragmentIndex" lib/memory/FragmentStore.js
```

- [ ] **Step 2: insert()에서 index() 호출 시 keyId 전달**

FragmentStore.insert()에서 `this.index.index(fragment, sessionId)` 호출을 찾아서:

```js
// 기존:
await this.index.index(fragment, sessionId);
// 변경:
await this.index.index(fragment, sessionId, fragment.key_id ?? null);
```

- [ ] **Step 3: delete()에서 deindex() 호출 시 keyId 전달**

FragmentStore.delete()에서 `this.index.deindex(...)` 호출을 찾아서:

```js
// 기존:
await this.index.deindex(id, existing.keywords, existing.topic, existing.type);
// 변경:
await this.index.deindex(id, existing.keywords, existing.topic, existing.type, existing.key_id ?? null);
```

- [ ] **Step 4: 기존 테스트 회귀 확인**

```bash
npm test && npm run test:unit
```

- [ ] **Step 5: 커밋**

```bash
git add lib/memory/FragmentStore.js
git commit -m "feat: FragmentStore insert/delete에서 FragmentIndex keyId 전달"
```

---

## Chunk 4: LinkStore keyId 필터

### Task 4: LinkStore.getLinkedFragments에 keyId 필터 추가

**Files:**
- Modify: `lib/memory/LinkStore.js`
- Modify: `lib/memory/MemoryManager.js` (호출부)
- Test: 기존 테스트로 회귀 확인

- [ ] **Step 1: LinkStore.getLinkedFragments 시그니처 변경**

```js
// 기존: async getLinkedFragments(fromIds, relationType = null, agentId = "default")
// 변경: async getLinkedFragments(fromIds, relationType = null, agentId = "default", keyId = null)
```

SQL WHERE 절에 keyId 필터 추가:

```js
// 두 쿼리(relationType 있는/없는 분기) 모두 동일하게 적용
// WHERE 절 마지막에 추가:
//   - keyId == null (master): 필터 없음 (전체 조회)
//   - keyId != null: AND f.key_id = $N
```

safeRelationType 분기의 쿼리:

```js
if (safeRelationType) {
  const params = [fromIds, safeRelationType];
  let keyFilter = "";
  if (keyId != null) {
    params.push(keyId);
    keyFilter = `AND f.key_id = $${params.length}`;
  }
  result = await queryWithAgentVector(agentId,
    `SELECT DISTINCT ON (f.id)
                     f.id, f.content, f.topic, f.keywords, f.type,
                     f.importance, f.linked_to, f.access_count,
                     f.created_at, f.verified_at, l.relation_type,
                     COALESCE(l.weight, 1) AS link_weight,
                     CASE l.relation_type
                       WHEN 'resolved_by' THEN 1
                       WHEN 'caused_by'   THEN 2
                       ELSE 3
                     END AS relation_order
     FROM ${SCHEMA}.fragment_links l
     JOIN ${SCHEMA}.fragments f ON l.to_id = f.id
     WHERE l.from_id = ANY($1)
       AND l.relation_type = $2
       ${keyFilter}
     ORDER BY f.id, link_weight DESC, relation_order, f.importance DESC
     LIMIT ${MEMORY_CONFIG.linkedFragmentLimit}`,
    params
  );
}
```

relationType 없는 분기도 동일 패턴:

```js
} else {
  const params = [fromIds];
  let keyFilter = "";
  if (keyId != null) {
    params.push(keyId);
    keyFilter = `AND f.key_id = $${params.length}`;
  }
  result = await queryWithAgentVector(agentId,
    `SELECT DISTINCT ON (f.id)
                     f.id, f.content, f.topic, f.keywords, f.type,
                     f.importance, f.linked_to, f.access_count,
                     f.created_at, f.verified_at, l.relation_type,
                     COALESCE(l.weight, 1) AS link_weight,
                     CASE l.relation_type
                       WHEN 'resolved_by' THEN 1
                       WHEN 'caused_by'   THEN 2
                       ELSE 3
                     END AS relation_order
     FROM ${SCHEMA}.fragment_links l
     JOIN ${SCHEMA}.fragments f ON l.to_id = f.id
     WHERE l.from_id = ANY($1)
       AND l.relation_type IN ('caused_by', 'resolved_by', 'related')
       ${keyFilter}
     ORDER BY f.id, link_weight DESC, relation_order, f.importance DESC
     LIMIT ${MEMORY_CONFIG.linkedFragmentLimit}`,
    params
  );
}
```

- [ ] **Step 2: MemoryManager.js — getLinkedFragments 호출에 keyId 전달**

`lib/memory/MemoryManager.js:249-253` 수정:

```js
// 기존:
const linkedFrags = await this.store.getLinkedFragments(
  fromIds,
  params.linkRelationType || null,
  agentId
);
// 변경:
const linkedFrags = await this.store.getLinkedFragments(
  fromIds,
  params.linkRelationType || null,
  agentId,
  keyId
);
```

recall 메서드 내에서 keyId 변수가 이미 224행에서 선언되어 있으므로 그대로 사용.

- [ ] **Step 3: 기존 테스트 회귀 확인**

```bash
npm test && npm run test:unit
```

- [ ] **Step 4: 커밋**

```bash
git add lib/memory/LinkStore.js lib/memory/MemoryManager.js
git commit -m "feat: LinkStore.getLinkedFragments에 keyId 격리 필터 추가"
```

---

## Chunk 5: MemoryConsolidator 스코핑 명시

### Task 5: MemoryConsolidator — consolidate가 master-only 임을 명시, GC 쿼리에 key_id 조건

**Files:**
- Modify: `lib/memory/MemoryConsolidator.js`
- Test: 기존 테스트로 회귀 확인

- [ ] **Step 1: consolidate() JSDoc에 master-only 명시**

```js
/**
 * 전체 유지보수 실행 (master key 전용, 글로벌 스코프)
 *
 * API 키별 격리 대상이 아닌 시스템 레벨 유지보수 작업.
 * scheduler.js에서 주기적으로 호출되며, API 키 인증 없이 실행된다.
 *
 * @returns {Object} 작업 결과 요약
 */
```

- [ ] **Step 2: server.js 또는 scheduler.js에서 consolidate 호출 시 master-only 검증**

consolidate를 MCP 도구로 호출하는 경로(`tool_memoryConsolidate`)에서, DB API key 사용자의 호출을 차단:

`lib/tools/memory.js` tool_memoryConsolidate:

```js
export async function tool_memoryConsolidate(args) {
  const keyId = args._keyId ?? null;
  delete args._sessionId;
  if (keyId != null) {
    return { success: false, error: "memory_consolidate is master-key only" };
  }
  // ... 기존 로직
}
```

- [ ] **Step 3: 기존 테스트 회귀 확인**

```bash
npm test && npm run test:unit
```

- [ ] **Step 4: 커밋**

```bash
git add lib/memory/MemoryConsolidator.js lib/tools/memory.js
git commit -m "feat: consolidate를 master-key 전용으로 제한, JSDoc 명시"
```

---

## Chunk 6: 통합 검증

### Task 6: 전체 회귀 테스트 + 격리 수동 검증

- [ ] **Step 1: 전체 테스트 실행**

```bash
npm test && npm run test:unit
```

예상: Jest 23+/23+, node:test 66+ 전수 통과

- [ ] **Step 2: 새로 추가한 격리 테스트 포함 확인**

```bash
node --test tests/unit/fragment-index-isolation.test.js
```

예상: 6/6 통과

- [ ] **Step 3: 커밋 히스토리 확인**

```bash
git log --oneline -6
```

예상 커밋 5개:
1. feat: FragmentIndex Redis 키에 keyId 네임스페이스 격리 추가
2. feat: FragmentSearch L1/HotCache에 keyId 격리 전파
3. feat: FragmentStore insert/delete에서 FragmentIndex keyId 전달
4. feat: LinkStore.getLinkedFragments에 keyId 격리 필터 추가
5. feat: consolidate를 master-key 전용으로 제한, JSDoc 명시

---

## 예상 결과

| 레이어 | 변경 전 | 변경 후 |
|--------|---------|---------|
| L1 역인덱스 (keyword/topic/type) | 글로벌 키 → 전체 에이전트 파편 혼합 | keyId별 네임스페이스 분리 |
| L1 Hot Cache | `frag:hot:{id}` → 타 에이전트 파편 접근 가능 | `frag:hot:{ns}:{id}` → 소유자만 접근 |
| L1 Recent | `frag:recent` 단일 ZSET | `frag:recent:{ns}` 키별 분리 |
| Linked fragments | keyId 필터 없음 | `WHERE f.key_id = $N` 추가 |
| Consolidation | 글로벌 실행 | master-key 전용으로 제한 (기존 동작 유지) |

**기존 동작 호환:** 모든 새 파라미터에 `keyId = null` 기본값. master key 사용 시 `_g` 네임스페이스로 기존과 동일하게 동작. 기존 Redis 키(`frag:kw:database` 등)는 orphan이 되지만 TTL/prune으로 자연 소멸.

**마이그레이션 불필요:** Redis 키 네이밍 변경만으로 DB 스키마 변경 없음. 기존 Redis 데이터는 warm-up 기간 동안 자동 재구축.
