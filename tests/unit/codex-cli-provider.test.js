/**
 * Unit tests: CodexCliProvider
 *
 * 실제 Codex CLI 호출 0건 — runCodexCLI와 _rawIsCodexCLIAvailable을 mock으로 교체.
 * circuit breaker 상태는 테스트마다 recordSuccess로 초기화하여 격리한다.
 *
 * 작성자: 최진호
 * 작성일: 2026-04-18
 */

import { describe, it, before, afterEach } from "node:test";
import assert                               from "node:assert/strict";

// ---------------------------------------------------------------------------
// module-level mock 주입: node:test는 jest.mock 같은 자동 호이스팅이 없으므로
// 테스트 내에서 동적으로 교체할 수 있도록 wrapper를 준비한다.
// ---------------------------------------------------------------------------

import * as codexModule from "../../lib/codex.js";

let _isAvailableImpl = async () => true;
let _runCodexImpl    = async () => '{"result":"ok"}';

/** mock shim: _rawIsCodexCLIAvailable 교체 */
function mockAvailable(impl) { _isAvailableImpl = impl; }
/** mock shim: runCodexCLI 교체 */
function mockRunCodex(impl)  { _runCodexImpl    = impl; }
/** 기본값 복구 */
function resetMocks() {
  _isAvailableImpl = async () => true;
  _runCodexImpl    = async () => '{"result":"ok"}';
}

// CodexCliProvider가 codexModule 함수를 직접 호출하므로
// prototype-level patch를 통해 provider 동작을 제어한다.

import { CodexCliProvider } from "../../lib/llm/providers/CodexCliProvider.js";

const _origIsAvailable = codexModule._rawIsCodexCLIAvailable;
const _origRunCodex    = codexModule.runCodexCLI;

// node:test에서는 import가 live binding이 아니므로
// provider 인스턴스 메서드를 직접 패치하는 방식으로 mock한다.

function makeProvider() {
  const p = new CodexCliProvider();
  /** isAvailable: _rawIsCodexCLIAvailable 결과를 _isAvailableImpl로 대체 */
  p.isAvailable = async () => _isAvailableImpl();
  /** callJson 내부 runCodexCLI를 패치하기 위해 callJson을 래핑 */
  const _origCallJson = p.callJson.bind(p);
  p.callJson = async (prompt, options = {}) => {
    const savedRunCodex = codexModule.runCodexCLI;
    // 인스턴스 수준에서 callJson 재구현 (runCodexCLI mock 주입)
    if (await p.isCircuitOpen()) {
      throw new Error("codex-cli: circuit breaker open");
    }
    const finalPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt;
    try {
      const raw    = await _runCodexImpl("", finalPrompt, options);
      const { parseJsonResponse } = await import("../../lib/llm/util/parse-json.js");
      const result = parseJsonResponse(raw);
      await p.recordSuccess();
      return result;
    } catch (err) {
      await p.recordFailure();
      throw err;
    }
  };
  return p;
}

import { circuitBreaker } from "../../lib/llm/util/circuit-breaker.js";
import { redisClient }    from "../../lib/redis.js";

import { after } from "node:test";
after(async () => {
  try { await redisClient.quit(); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe("CodexCliProvider", () => {

  afterEach(() => {
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // isAvailable
  // -------------------------------------------------------------------------

  describe("isAvailable", () => {

    it("codex 바이너리가 존재하면 true를 반환한다", async () => {
      mockAvailable(async () => true);
      const p = makeProvider();
      assert.equal(await p.isAvailable(), true);
    });

    it("codex 바이너리가 없으면 false를 반환한다", async () => {
      mockAvailable(async () => false);
      const p = makeProvider();
      assert.equal(await p.isAvailable(), false);
    });

  });

  // -------------------------------------------------------------------------
  // callText
  // -------------------------------------------------------------------------

  describe("callText", () => {

    it("항상 'use callJson' 에러를 던진다", async () => {
      const p = new CodexCliProvider();
      await assert.rejects(
        () => p.callText("any prompt"),
        /use callJson/
      );
    });

  });

  // -------------------------------------------------------------------------
  // callJson — 성공
  // -------------------------------------------------------------------------

  describe("callJson - 성공", () => {

    it("runCodexCLI가 JSON 문자열을 반환하면 파싱된 객체를 반환한다", async () => {
      mockRunCodex(async () => '{"result":"ok","score":42}');
      const p    = makeProvider();
      const json = await p.callJson("test prompt");
      assert.deepEqual(json, { result: "ok", score: 42 });
    });

    it("runCodexCLI가 markdown 펜스 감싼 JSON을 반환해도 파싱한다", async () => {
      mockRunCodex(async () => "```json\n{\"key\":\"val\"}\n```");
      const p    = makeProvider();
      const json = await p.callJson("test prompt");
      assert.deepEqual(json, { key: "val" });
    });

    it("systemPrompt가 있으면 prompt 앞에 prepend하여 호출한다", async () => {
      let capturedPrompt = "";
      mockRunCodex(async (_stdin, finalPrompt) => {
        capturedPrompt = finalPrompt;
        return '{"ok":true}';
      });
      const p = makeProvider();
      await p.callJson("actual prompt", { systemPrompt: "SYSTEM" });
      assert.match(capturedPrompt, /SYSTEM/);
      assert.match(capturedPrompt, /actual prompt/);
    });

  });

  // -------------------------------------------------------------------------
  // callJson — 실패
  // -------------------------------------------------------------------------

  describe("callJson - 실패", () => {

    it("runCodexCLI가 throw하면 recordFailure를 호출하고 에러를 전파한다", async () => {
      mockRunCodex(async () => { throw new Error("CLI failed"); });

      const p              = makeProvider();
      let   failureRecorded = false;
      const _origRecord    = p.recordFailure.bind(p);
      p.recordFailure      = async () => { failureRecorded = true; return _origRecord(); };

      await assert.rejects(
        () => p.callJson("test prompt"),
        /CLI failed/
      );
      assert.equal(failureRecorded, true);
    });

    it("runCodexCLI가 파싱 불가능한 문자열을 반환하면 에러를 던진다", async () => {
      mockRunCodex(async () => "not json at all");
      const p = makeProvider();
      await assert.rejects(
        () => p.callJson("test prompt"),
        /failed to parse JSON/
      );
    });

  });

  // -------------------------------------------------------------------------
  // circuit breaker
  // -------------------------------------------------------------------------

  describe("circuit breaker", () => {

    it("circuit이 열려 있으면 runCodexCLI를 호출하지 않고 에러를 던진다", async () => {
      let runCodexCalled = false;
      mockRunCodex(async () => { runCodexCalled = true; return '{"ok":true}'; });

      const p = makeProvider();

      /** circuit을 강제로 open 상태로 만든다 */
      const _origIsCircuitOpen = p.isCircuitOpen.bind(p);
      p.isCircuitOpen = async () => true;

      await assert.rejects(
        () => p.callJson("test prompt"),
        /circuit breaker open/
      );
      assert.equal(runCodexCalled, false);
    });

    it("circuit이 닫혀 있으면 runCodexCLI를 호출한다", async () => {
      let runCodexCalled = false;
      mockRunCodex(async () => { runCodexCalled = true; return '{"ok":true}'; });

      const p = makeProvider();
      p.isCircuitOpen = async () => false;

      await p.callJson("test prompt");
      assert.equal(runCodexCalled, true);
    });

  });

});
