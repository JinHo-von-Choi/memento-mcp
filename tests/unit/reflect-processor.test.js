/**
 * ReflectProcessor 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-04-05
 *
 * store/index/factory/sessionLinker/remember를 mock하여
 * ReflectProcessor.process()의 파편 생성, breakdown 집계,
 * 세션 통합, episode 생성을 검증한다.
 */

import { describe, it, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { ReflectProcessor } from "../../lib/memory/ReflectProcessor.js";
import { redisClient }      from "../../lib/redis.js";

/**
 * ReflectProcessor import 체인이 Redis ioredis 클라이언트를 즉시 연결하므로
 * 테스트 종료 후 명시적으로 quit하지 않으면 event loop가 유지되어
 * node:test가 "Promise resolution is still pending" 메시지와 함께 cleanup hang.
 */
after(async () => {
  try { await redisClient.quit(); } catch (_) {}
  try {
    const { getPrimaryPool } = await import("../../lib/tools/db.js");
    await getPrimaryPool()?.end();
  } catch (_) {}
});

/* ── mock 의존성 생성 헬퍼 ── */
let idCounter;

function createMockDeps(overrides = {}) {
  idCounter = 0;

  const store = {
    insert: mock.fn(async () => `frag-${++idCounter}`),
    ...overrides.store,
  };

  const index = {
    index            : mock.fn(async () => {}),
    clearWorkingMemory: mock.fn(async () => {}),
    ...overrides.index,
  };

  const factory = {
    create: mock.fn((opts) => ({
      content  : opts.content,
      topic    : opts.topic,
      type     : opts.type,
      keywords : opts.keywords || [],
      source   : opts.source,
      agent_id : opts.agentId,
    })),
    splitAndCreate: mock.fn((text, opts) => [{ content: text }]),
    ...overrides.factory,
  };

  const sessionLinker = {
    consolidateSessionFragments: mock.fn(async () => null),
    autoLinkSessionFragments   : mock.fn(async () => {}),
    ...overrides.sessionLinker,
  };

  const rememberFn = overrides.remember ?? mock.fn(async () => ({ id: "ep-1" }));

  return { store, index, factory, sessionLinker, remember: rememberFn };
}

/* ── summary 테스트 ── */
describe("ReflectProcessor - summary", () => {
  it("문자열 summary를 fact 파편으로 변환", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    const result = await processor.process({
      summary: "세션 요약 텍스트",
      agentId: "test-agent",
    });

    assert.equal(result.breakdown.summary, 1);
    assert.equal(result.fragments.length, 1);
    assert.equal(result.fragments[0].type, "fact");
    assert.equal(deps.store.insert.mock.callCount(), 1);
    assert.equal(deps.index.index.mock.callCount(), 1);
  });

  it("배열 summary를 각각 fact 파편으로 변환", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    const result = await processor.process({
      summary: ["요약 1", "요약 2", "요약 3"],
      agentId: "test-agent",
    });

    assert.equal(result.breakdown.summary, 3);
    assert.equal(result.count, 3);
  });

  it("빈 문자열 summary 항목은 필터링", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    const result = await processor.process({
      summary: ["유효", "", "  "],
      agentId: "test-agent",
    });

    assert.equal(result.breakdown.summary, 1);
  });
});

/* ── decisions 테스트 ── */
describe("ReflectProcessor - decisions", () => {
  it("decisions 배열을 decision 파편으로 변환", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    const result = await processor.process({
      decisions: ["TypeScript 채택", "PostgreSQL 선택"],
      agentId  : "test-agent",
    });

    assert.equal(result.breakdown.decisions, 2);
    assert.equal(result.fragments[0].type, "decision");
    assert.equal(result.fragments[1].type, "decision");

    const createCalls = deps.factory.create.mock.calls;
    assert.equal(createCalls[0].arguments[0].importance, 0.8);
  });
});

/* ── errors_resolved 테스트 ── */
describe("ReflectProcessor - errors_resolved", () => {
  it("errors_resolved를 [해결됨] prefix 포함 error 파편으로 변환", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    const result = await processor.process({
      errors_resolved: ["NPE 해결"],
      agentId        : "test-agent",
    });

    assert.equal(result.breakdown.errors, 1);
    assert.equal(result.fragments[0].type, "error");
    const createCall = deps.factory.create.mock.calls[0].arguments[0];
    assert.ok(createCall.content.startsWith("[해결됨]"));
    assert.equal(createCall.importance, 0.5);
  });
});

/* ── new_procedures 테스트 ── */
describe("ReflectProcessor - new_procedures", () => {
  it("new_procedures를 procedure 파편으로 변환", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    const result = await processor.process({
      new_procedures: ["배포 절차 v2"],
      agentId       : "test-agent",
    });

    assert.equal(result.breakdown.procedures, 1);
    assert.equal(result.fragments[0].type, "procedure");
    const createCall = deps.factory.create.mock.calls[0].arguments[0];
    assert.equal(createCall.importance, 0.7);
  });
});

/* ── open_questions 테스트 ── */
describe("ReflectProcessor - open_questions", () => {
  it("open_questions를 [미해결] prefix 포함 fact 파편으로 변환", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    const result = await processor.process({
      open_questions: ["Redis 클러스터 이슈"],
      agentId       : "test-agent",
    });

    assert.equal(result.breakdown.questions, 1);
    assert.equal(result.fragments[0].type, "fact");
    const createCall = deps.factory.create.mock.calls[0].arguments[0];
    assert.ok(createCall.content.startsWith("[미해결]"));
    assert.equal(createCall.importance, 0.4);
  });
});

/* ── 세션 통합 테스트 ── */
describe("ReflectProcessor - session consolidation", () => {
  it("sessionId 존재 시 consolidateSessionFragments 호출", async () => {
    const deps = createMockDeps({
      sessionLinker: {
        consolidateSessionFragments: mock.fn(async () => ({
          summary         : "통합 요약",
          decisions       : ["통합 결정"],
          errors_resolved : null,
          new_procedures  : null,
          open_questions  : null,
        })),
        autoLinkSessionFragments: mock.fn(async () => {}),
      },
    });
    const processor = new ReflectProcessor(deps);

    const result = await processor.process({
      sessionId: "sess-1",
      agentId  : "test-agent",
    });

    assert.equal(deps.sessionLinker.consolidateSessionFragments.mock.callCount(), 1);
    assert.equal(result.breakdown.summary, 1);
    assert.equal(result.breakdown.decisions, 1);
  });

  it("sessionId 존재 시 clearWorkingMemory 호출", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    await processor.process({ sessionId: "sess-1", agentId: "test-agent" });

    assert.equal(deps.index.clearWorkingMemory.mock.callCount(), 1);
    assert.equal(deps.index.clearWorkingMemory.mock.calls[0].arguments[0], "sess-1");
  });

  it("sessionId 없으면 clearWorkingMemory 미호출", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    await processor.process({ summary: "테스트", agentId: "test-agent" });

    assert.equal(deps.index.clearWorkingMemory.mock.callCount(), 0);
  });
});

/* ── narrative_summary → episode 생성 ── */
describe("ReflectProcessor - narrative_summary", () => {
  it("narrative_summary 있으면 remember()로 episode 파편 생성", async () => {
    const rememberFn = mock.fn(async () => ({ id: "ep-1" }));
    const deps       = createMockDeps({ remember: rememberFn });
    const processor  = new ReflectProcessor(deps);

    const result = await processor.process({
      summary           : "요약",
      narrative_summary : "세션 서사",
      sessionId         : "sess-1",
      agentId           : "test-agent",
    });

    assert.equal(rememberFn.mock.callCount(), 1);
    const rememberArgs = rememberFn.mock.calls[0].arguments[0];
    assert.equal(rememberArgs.type, "episode");
    assert.equal(rememberArgs.content, "세션 서사");
    assert.equal(rememberArgs.sessionId, "sess-1");
    assert.equal(result.breakdown.episode, 1);
  });
});

/* ── 복합 입력 ── */
describe("ReflectProcessor - combined", () => {
  it("모든 항목 동시 입력 시 각 breakdown 정확히 집계", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    const result = await processor.process({
      summary        : ["요약 A", "요약 B"],
      decisions      : ["결정 1"],
      errors_resolved: ["에러 1", "에러 2"],
      new_procedures : ["절차 1"],
      open_questions : ["질문 1"],
      agentId        : "test-agent",
    });

    assert.equal(result.breakdown.summary, 2);
    assert.equal(result.breakdown.decisions, 1);
    assert.equal(result.breakdown.errors, 2);
    assert.equal(result.breakdown.procedures, 1);
    assert.equal(result.breakdown.questions, 1);
    assert.equal(result.count, 7);
  });
});

/* ── resolutionStatus 자동 세팅 ── */
describe("ReflectProcessor - resolutionStatus", () => {
  it("errors_resolved 파편에 resolutionStatus='resolved' 세팅", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    await processor.process({
      errors_resolved: ["NPE 수정 완료"],
      sessionId      : "sess-rs",
      agentId        : "test-agent",
    });

    const createCall = deps.factory.create.mock.calls[0].arguments[0];
    assert.equal(createCall.resolutionStatus, "resolved");
  });

  it("open_questions 파편에 resolutionStatus='open' 세팅", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    await processor.process({
      open_questions: ["캐시 전략 미확정"],
      sessionId     : "sess-rs",
      agentId       : "test-agent",
    });

    const createCall = deps.factory.create.mock.calls[0].arguments[0];
    assert.equal(createCall.resolutionStatus, "open");
  });
});

/* ── sessionId 전파 ── */
describe("ReflectProcessor - sessionId propagation", () => {
  it("sessionId가 모든 섹션의 factory.create()에 전파됨", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    await processor.process({
      summary        : ["요약"],
      decisions      : ["결정"],
      errors_resolved: ["에러"],
      new_procedures : ["절차"],
      open_questions : ["질문"],
      sessionId      : "sess-prop",
      agentId        : "test-agent",
    });

    const calls = deps.factory.create.mock.calls;
    assert.equal(calls.length, 5);
    for (const call of calls) {
      assert.equal(call.arguments[0].sessionId, "sess-prop",
        `sessionId missing in ${call.arguments[0].type} fragment`);
    }
  });
});

/* ── keyId / workspace 전파 ── */
describe("ReflectProcessor - keyId and workspace propagation", () => {
  it("_keyId와 workspace가 파편에 전파됨", async () => {
    const deps      = createMockDeps();
    const processor = new ReflectProcessor(deps);

    await processor.process({
      summary  : "테스트",
      _keyId   : "key-abc",
      workspace: "ws-1",
      agentId  : "test-agent",
    });

    const insertArg = deps.store.insert.mock.calls[0].arguments[0];
    assert.equal(insertArg.key_id, "key-abc");
    assert.equal(insertArg.workspace, "ws-1");
  });
});

/* ── insert 실패 시 graceful 처리 ── */
describe("ReflectProcessor - insert failure handling", () => {
  it("일부 insert 실패 시 성공한 파편만 반환, 에러 삼키지 않음", async () => {
    let callCount = 0;
    const deps    = createMockDeps({
      store: {
        insert: mock.fn(async () => {
          callCount++;
          if (callCount === 2) throw new Error("DB insert failed");
          return `frag-${callCount}`;
        }),
      },
    });
    const processor = new ReflectProcessor(deps);

    const result = await processor.process({
      summary: ["성공 1", "실패할 항목", "성공 2"],
      agentId: "test-agent",
    });

    assert.equal(result.fragments.length, 2);
    assert.equal(result.breakdown.summary, 3);
  });
});
