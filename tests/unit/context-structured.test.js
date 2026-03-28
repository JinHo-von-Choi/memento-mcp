import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * context() structured 응답 테스트
 *
 * MemoryManager.context()를 직접 호출하지 않고,
 * 반환 구조의 shape만 검증하는 순수 단위 테스트.
 * recall/store를 mock하여 DB 의존 없이 실행.
 */

function makeFrag(id, type, content, opts = {}) {
  return {
    id,
    type,
    content,
    topic      : opts.topic      || "test",
    importance : opts.importance  || 0.5,
    access_count: opts.access_count || 1,
    is_anchor  : opts.is_anchor  || false,
    source     : opts.source     || null,
    accessed_at: opts.accessed_at || new Date().toISOString(),
    ...opts
  };
}

/**
 * context() 핵심 로직을 시뮬레이션하는 헬퍼.
 * 실제 MemoryManager의 structured 분기 로직만 추출.
 */
function buildContextResponse({ coreFragments, wmFragments, anchorFragments, learningFragments, structured }) {
  const usedChars   = coreFragments.reduce((s, f) => s + (f.content || "").length, 0);
  const wmChars     = wmFragments.reduce((s, f) => s + (f.content || "").length, 0);
  const anchorChars = anchorFragments.reduce((s, f) => s + (f.content || "").length, 0);

  const coreTokens   = Math.ceil(usedChars / 4);
  const wmTokens     = Math.ceil(wmChars / 4);
  const anchorTokens = Math.ceil(anchorChars / 4);

  const allFragments = [...anchorFragments, ...coreFragments, ...wmFragments];
  const dedupSeen    = new Set();
  const dedupResult  = [];
  for (const f of allFragments) {
    if (f.id && dedupSeen.has(f.id)) continue;
    if (f.id) dedupSeen.add(f.id);
    dedupResult.push(f);
  }

  const injectionText = "[mock injection]";

  if (structured === true) {
    const coreByType = {};
    for (const f of coreFragments) {
      const key = f.type || "general";
      if (!coreByType[key]) coreByType[key] = [];
      coreByType[key].push(f);
    }

    return {
      success      : true,
      structured   : true,
      core         : {
        preferences: coreByType.preference || [],
        errors     : coreByType.error      || [],
        decisions  : coreByType.decision   || [],
        procedures : coreByType.procedure  || [],
        ...Object.fromEntries(
          Object.entries(coreByType)
            .filter(([k]) => !["preference", "error", "decision", "procedure"].includes(k))
        )
      },
      working      : {
        current_session: wmFragments
      },
      anchors      : {
        permanent: anchorFragments
      },
      learning     : {
        recent: learningFragments
      },
      totalTokens  : anchorTokens + coreTokens + wmTokens,
      count        : dedupResult.length,
      anchorTokens,
      coreTokens,
      wmTokens,
      wmCount      : wmFragments.length,
      anchorCount  : anchorFragments.length,
      injectionText
    };
  }

  return {
    fragments    : dedupResult,
    totalTokens  : anchorTokens + coreTokens + wmTokens,
    count        : dedupResult.length,
    anchorTokens,
    coreTokens,
    wmTokens,
    wmCount      : wmFragments.length,
    anchorCount  : anchorFragments.length,
    injectionText
  };
}

describe("context() structured 응답", () => {
  const prefFrag     = makeFrag("f1", "preference", "한국어 사용");
  const errFrag      = makeFrag("f2", "error", "ECONNREFUSED 해결");
  const decFrag      = makeFrag("f3", "decision", "PostgreSQL 선택");
  const procFrag     = makeFrag("f4", "procedure", "배포 절차");
  const wmFrag       = makeFrag("f5", "fact", "현재 작업 컨텍스트");
  const anchorFrag   = makeFrag("f6", "fact", "절대 불변 지식", { is_anchor: true });
  const learningFrag = makeFrag("f7", "fact", "학습 추출 결과", { source: "learning_extraction" });

  const coreFragments     = [prefFrag, errFrag, decFrag, procFrag];
  const wmFragments       = [wmFrag];
  const anchorFragments   = [anchorFrag];
  const learningFragments = [learningFrag];

  test("structured=true 시 트리 구조 반환", () => {
    const result = buildContextResponse({
      coreFragments, wmFragments, anchorFragments, learningFragments,
      structured: true
    });

    assert.equal(result.success, true);
    assert.equal(result.structured, true);

    assert.ok(result.core,    "core 카테고리 존재");
    assert.ok(result.working, "working 카테고리 존재");
    assert.ok(result.anchors, "anchors 카테고리 존재");
    assert.ok(result.learning,"learning 카테고리 존재");

    assert.equal(result.fragments, undefined, "flat fragments 필드 없음");
  });

  test("structured=true 시 core 내부 type별 분류", () => {
    const result = buildContextResponse({
      coreFragments, wmFragments, anchorFragments, learningFragments,
      structured: true
    });

    assert.equal(result.core.preferences.length, 1);
    assert.equal(result.core.preferences[0].id, "f1");

    assert.equal(result.core.errors.length, 1);
    assert.equal(result.core.errors[0].id, "f2");

    assert.equal(result.core.decisions.length, 1);
    assert.equal(result.core.decisions[0].id, "f3");

    assert.equal(result.core.procedures.length, 1);
    assert.equal(result.core.procedures[0].id, "f4");
  });

  test("structured=true 시 working/anchors/learning 매핑", () => {
    const result = buildContextResponse({
      coreFragments, wmFragments, anchorFragments, learningFragments,
      structured: true
    });

    assert.equal(result.working.current_session.length, 1);
    assert.equal(result.working.current_session[0].id, "f5");

    assert.equal(result.anchors.permanent.length, 1);
    assert.equal(result.anchors.permanent[0].id, "f6");

    assert.equal(result.learning.recent.length, 1);
    assert.equal(result.learning.recent[0].id, "f7");
  });

  test("structured=true 시 토큰 메타 필드 유지", () => {
    const result = buildContextResponse({
      coreFragments, wmFragments, anchorFragments, learningFragments,
      structured: true
    });

    assert.equal(typeof result.totalTokens, "number");
    assert.equal(typeof result.coreTokens,  "number");
    assert.equal(typeof result.wmTokens,    "number");
    assert.equal(typeof result.anchorTokens,"number");
    assert.equal(typeof result.count,       "number");
    assert.equal(typeof result.wmCount,     "number");
    assert.equal(typeof result.anchorCount, "number");
    assert.ok(result.injectionText, "injectionText 존재");
  });

  test("structured=false 시 기존 flat list 반환", () => {
    const result = buildContextResponse({
      coreFragments, wmFragments, anchorFragments, learningFragments,
      structured: false
    });

    assert.ok(Array.isArray(result.fragments), "fragments 배열 존재");
    assert.equal(result.structured, undefined, "structured 필드 없음");
    assert.equal(result.core,     undefined, "core 필드 없음");
    assert.equal(result.working,  undefined, "working 필드 없음");
    assert.equal(result.anchors,  undefined, "anchors 필드 없음");
    assert.equal(result.learning, undefined, "learning 필드 없음");
  });

  test("structured 미지정 시 기존 flat list 반환", () => {
    const result = buildContextResponse({
      coreFragments, wmFragments, anchorFragments, learningFragments,
      structured: undefined
    });

    assert.ok(Array.isArray(result.fragments), "fragments 배열 존재");
    assert.equal(result.core, undefined, "core 필드 없음");
  });

  test("빈 카테고리도 빈 배열로 존재", () => {
    const result = buildContextResponse({
      coreFragments     : [prefFrag],
      wmFragments       : [],
      anchorFragments   : [],
      learningFragments : [],
      structured: true
    });

    assert.deepStrictEqual(result.core.errors,     []);
    assert.deepStrictEqual(result.core.decisions,   []);
    assert.deepStrictEqual(result.core.procedures,  []);
    assert.deepStrictEqual(result.working.current_session, []);
    assert.deepStrictEqual(result.anchors.permanent, []);
    assert.deepStrictEqual(result.learning.recent,   []);
  });

  test("비표준 type도 core에 포함", () => {
    const customFrag = makeFrag("f8", "custom_type", "특수 유형 파편");
    const result = buildContextResponse({
      coreFragments     : [prefFrag, customFrag],
      wmFragments       : [],
      anchorFragments   : [],
      learningFragments : [],
      structured: true
    });

    assert.ok(result.core.custom_type, "비표준 type 키 존재");
    assert.equal(result.core.custom_type.length, 1);
    assert.equal(result.core.custom_type[0].id, "f8");
  });
});
