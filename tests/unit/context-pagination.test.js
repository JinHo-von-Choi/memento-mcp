/**
 * 컨텍스트 주입 스마트 캡 및 recall 페이지네이션 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-07
 *
 * context() 파편 수 상한 + 유형별 슬롯 제한, recall() cursor 기반 페이지네이션 검증.
 * DB/Redis 의존 없이 핵심 알고리즘만 추출하여 테스트한다.
 */

import { describe, it } from "node:test";
import assert            from "node:assert/strict";
import { MEMORY_CONFIG } from "../../config/memory.js";

/**
 * context() 스마트 캡 알고리즘 재현 (MemoryManager.context 내부 로직 추출)
 *
 * @param {Map}    guaranteed     - 유형별 초기 파편 (guaranteed 1개씩)
 * @param {Array}  extras         - 추가 후보 파편 (importance 내림차순)
 * @param {number} coreCharBudget - 문자 예산
 * @param {number} usedChars      - 이미 사용된 문자 수
 * @returns {{ guaranteed: Map, totalAdded: number, usedChars: number }}
 */
function applySmartCap(guaranteed, extras, coreCharBudget, usedChars) {
  const maxCore      = MEMORY_CONFIG.contextInjection?.maxCoreFragments || 15;
  const typeSlots    = MEMORY_CONFIG.contextInjection?.typeSlots || {};

  let coreCount = 0;
  for (const [, frags] of guaranteed) {
    coreCount += frags.length;
  }
  let totalAdded = coreCount;

  const typeCounters = {};
  for (const [type, frags] of guaranteed) {
    typeCounters[type] = frags.length;
  }

  for (const f of extras) {
    if (totalAdded >= maxCore) break;

    const typeKey = f.type || "general";
    const typeMax = typeSlots[typeKey] || 5;
    const current = typeCounters[typeKey] || 0;
    if (current >= typeMax) continue;

    const cost = (f.content || "").length;
    if (usedChars + cost > coreCharBudget) {
      const remaining = coreCharBudget - usedChars;
      if (remaining > 80) {
        const truncated = { ...f, content: f.content.substring(0, remaining - 3) + "..." };
        const typeArr   = guaranteed.get(typeKey) || [];
        typeArr.push(truncated);
        guaranteed.set(typeKey, typeArr);
        usedChars += remaining;
        typeCounters[typeKey] = (typeCounters[typeKey] || 0) + 1;
        totalAdded++;
      }
      break;
    }

    const typeArr = guaranteed.get(typeKey) || [];
    typeArr.push(f);
    guaranteed.set(typeKey, typeArr);
    usedChars += cost;
    typeCounters[typeKey] = (typeCounters[typeKey] || 0) + 1;
    totalAdded++;
  }

  return { guaranteed, totalAdded, usedChars };
}

/**
 * recall() 페이지네이션 알고리즘 재현
 *
 * @param {Array}       fragments - 전체 결과 파편
 * @param {Object}      params    - { cursor, pageSize, anchorTime }
 * @returns {{ fragments, count, totalCount, nextCursor, hasMore }}
 */
function applyPagination(fragments, params = {}) {
  const pageSize = Math.min(
    params.pageSize || MEMORY_CONFIG.pagination?.defaultPageSize || 20,
    MEMORY_CONFIG.pagination?.maxPageSize || 50
  );

  let   offset     = 0;
  let   anchorSnap = params.anchorTime || Date.now();
  if (params.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(params.cursor, "base64url").toString());
      offset     = decoded.offset     || 0;
      anchorSnap = decoded.anchorTime  || anchorSnap;
    } catch { /* 잘못된 cursor 무시 */ }
  }

  const totalCount = fragments.length;
  const paged      = fragments.slice(offset, offset + pageSize);
  const hasMore    = offset + pageSize < totalCount;
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ offset: offset + pageSize, anchorTime: anchorSnap })).toString("base64url")
    : null;

  return {
    fragments : paged,
    count     : paged.length,
    totalCount,
    nextCursor,
    hasMore
  };
}

/** 헬퍼: 파편 생성 */
function frag(id, type, content = "test content", importance = 0.5) {
  return { id, type, content, importance };
}

describe("context() 스마트 캡", () => {

  it("maxCoreFragments 상한 초과 방지", () => {
    const guaranteed = new Map();
    guaranteed.set("preference", [frag("g1", "preference")]);
    guaranteed.set("error",      [frag("g2", "error")]);
    guaranteed.set("procedure",  [frag("g3", "procedure")]);

    const extras = [];
    for (let i = 0; i < 30; i++) {
      extras.push(frag(`e${i}`, "preference", `extra content ${i}`));
    }

    const result = applySmartCap(guaranteed, extras, 100000, 0);
    assert.ok(
      result.totalAdded <= 15,
      `총 추가 파편(${result.totalAdded})이 maxCoreFragments(15) 이하여야 한다`
    );
  });

  it("유형별 슬롯 제한 준수", () => {
    const guaranteed = new Map();
    guaranteed.set("fact", [frag("g1", "fact")]);

    const extras = [];
    for (let i = 0; i < 10; i++) {
      extras.push(frag(`f${i}`, "fact", `fact content ${i}`));
    }

    const result = applySmartCap(guaranteed, extras, 100000, 0);
    const factCount = result.guaranteed.get("fact")?.length || 0;

    assert.ok(
      factCount <= (MEMORY_CONFIG.contextInjection.typeSlots.fact || 3),
      `fact 파편 수(${factCount})가 typeSlots.fact(${MEMORY_CONFIG.contextInjection.typeSlots.fact}) 이하여야 한다`
    );
  });

  it("유형별 guaranteed 1개 보장", () => {
    const guaranteed = new Map();
    guaranteed.set("preference", [frag("g1", "preference")]);
    guaranteed.set("error",      [frag("g2", "error")]);
    guaranteed.set("procedure",  [frag("g3", "procedure")]);

    const extras = [];
    const result = applySmartCap(guaranteed, extras, 100000, 0);

    for (const type of ["preference", "error", "procedure"]) {
      const frags = result.guaranteed.get(type) || [];
      assert.ok(
        frags.length >= 1,
        `${type} 유형은 최소 1개 보장되어야 한다 (현재: ${frags.length})`
      );
    }
  });

  it("coreCharBudget 초과 시 truncation 동작", () => {
    const guaranteed = new Map();
    guaranteed.set("preference", [frag("g1", "preference", "short")]);

    const longContent = "A".repeat(200);
    const extras      = [frag("e1", "preference", longContent)];

    const result = applySmartCap(guaranteed, extras, 150, "short".length);

    const prefs = result.guaranteed.get("preference") || [];
    if (prefs.length > 1) {
      const added = prefs[prefs.length - 1];
      assert.ok(
        added.content.endsWith("..."),
        "예산 초과 시 truncation이 적용되어야 한다"
      );
    }
  });
});

describe("recall() 페이지네이션", () => {

  it("pageSize보다 결과가 많으면 nextCursor 반환", () => {
    const fragments = Array.from({ length: 25 }, (_, i) => frag(`r${i}`, "fact"));
    const result    = applyPagination(fragments, { pageSize: 10 });

    assert.equal(result.count, 10);
    assert.equal(result.totalCount, 25);
    assert.equal(result.hasMore, true);
    assert.ok(result.nextCursor !== null, "nextCursor가 반환되어야 한다");
  });

  it("cursor로 다음 페이지 조회", () => {
    const fragments = Array.from({ length: 25 }, (_, i) => frag(`r${i}`, "fact"));

    const page1 = applyPagination(fragments, { pageSize: 10 });
    assert.equal(page1.fragments[0].id, "r0");
    assert.equal(page1.count, 10);

    const page2 = applyPagination(fragments, { pageSize: 10, cursor: page1.nextCursor });
    assert.equal(page2.fragments[0].id, "r10");
    assert.equal(page2.count, 10);
    assert.equal(page2.hasMore, true);

    const page3 = applyPagination(fragments, { pageSize: 10, cursor: page2.nextCursor });
    assert.equal(page3.fragments[0].id, "r20");
    assert.equal(page3.count, 5);
    assert.equal(page3.hasMore, false);
    assert.equal(page3.nextCursor, null);
  });

  it("마지막 페이지에서 hasMore=false", () => {
    const fragments = Array.from({ length: 5 }, (_, i) => frag(`r${i}`, "fact"));
    const result    = applyPagination(fragments, { pageSize: 20 });

    assert.equal(result.count, 5);
    assert.equal(result.totalCount, 5);
    assert.equal(result.hasMore, false);
    assert.equal(result.nextCursor, null);
  });

  it("pageSize가 maxPageSize를 초과하면 maxPageSize로 제한", () => {
    const fragments = Array.from({ length: 100 }, (_, i) => frag(`r${i}`, "fact"));
    const result    = applyPagination(fragments, { pageSize: 999 });

    assert.equal(result.count, MEMORY_CONFIG.pagination.maxPageSize);
  });

  it("잘못된 cursor는 기본값으로 fallback", () => {
    const fragments = Array.from({ length: 10 }, (_, i) => frag(`r${i}`, "fact"));
    const result    = applyPagination(fragments, { pageSize: 5, cursor: "invalid-base64" });

    assert.equal(result.fragments[0].id, "r0");
    assert.equal(result.count, 5);
  });

  it("anchorTime이 cursor에 보존됨", () => {
    const fragments  = Array.from({ length: 25 }, (_, i) => frag(`r${i}`, "fact"));
    const anchorTime = 1700000000000;

    const page1   = applyPagination(fragments, { pageSize: 10, anchorTime });
    const decoded = JSON.parse(Buffer.from(page1.nextCursor, "base64url").toString());

    assert.equal(decoded.anchorTime, anchorTime, "anchorTime이 cursor에 보존되어야 한다");
    assert.equal(decoded.offset, 10, "offset이 10이어야 한다");
  });
});
