/**
 * Unit tests: lib/llm/util/retry-hints.js
 *
 * extractRetryHintMs / computeCooldown 의 힌트 추출 + 쿨다운 산출 로직 검증.
 * 실제 HTTP 호출 없음. Response 객체를 mock 으로 구성.
 *
 * 작성자: 최진호
 * 작성일: 2026-04-24
 */

import { describe, it } from "node:test";
import assert           from "node:assert/strict";

import { extractRetryHintMs, computeCooldown } from "../../lib/llm/util/retry-hints.js";

/**
 * 가짜 Response 생성기 — Headers Map + 선택적 본문만 노출.
 */
function makeRes(headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: {
      get(name) {
        return h.get(String(name).toLowerCase()) ?? null;
      }
    }
  };
}

describe("extractRetryHintMs — Retry-After 헤더", () => {
  it("초 정수면 ms로 환산된 값을 반환한다", () => {
    const res = makeRes({ "Retry-After": "15" });
    assert.equal(extractRetryHintMs(res, ""), 15_000);
  });

  it("HTTP-date 형식을 파싱한다", () => {
    const future = new Date(Date.now() + 5_000).toUTCString();
    const res    = makeRes({ "Retry-After": future });
    const hint   = extractRetryHintMs(res, "");
    assert.ok(hint >= 4_000 && hint <= 6_000, `hint=${hint}, expected ~5000`);
  });

  it("잘못된 값은 무시 (0 반환)", () => {
    const res = makeRes({ "Retry-After": "garbage" });
    assert.equal(extractRetryHintMs(res, ""), 0);
  });
});

describe("extractRetryHintMs — 본문 RetryInfo", () => {
  it("retryDelay 'Ns' 문자열을 ms로 환산한다", () => {
    const body = JSON.stringify({
      error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7.5s" }] }
    });
    assert.equal(extractRetryHintMs(makeRes(), body), 7_500);
  });

  it("Retry-After 와 retryDelay 가 모두 있으면 큰 값을 택한다", () => {
    const body = JSON.stringify({
      error: { details: [{ "@type": "RetryInfo", retryDelay: "2s" }] }
    });
    const res  = makeRes({ "Retry-After": "10" });
    assert.equal(extractRetryHintMs(res, body), 10_000);
  });

  it("retry_after 필드(초, OpenAI 호환)를 인식한다", () => {
    const body = JSON.stringify({ error: { retry_after: 4 } });
    assert.equal(extractRetryHintMs(makeRes(), body), 4_000);
  });

  it("JSON 아닌 본문은 무시 (0 반환)", () => {
    assert.equal(extractRetryHintMs(makeRes(), "plain text"), 0);
  });
});

describe("computeCooldown", () => {
  it("힌트 없을 때 minMs~maxMs 사이의 지터를 반환한다", () => {
    const { cooldownMs, hintMs } = computeCooldown({
      res: makeRes(), bodyText: "", minMs: 100, maxMs: 200, hardCapMs: 60_000
    });
    assert.equal(hintMs, 0);
    assert.ok(cooldownMs >= 100 && cooldownMs <= 200, `cooldown=${cooldownMs}`);
  });

  it("힌트가 있으면 지터와 max 비교 후 큰 값을 택한다", () => {
    const { cooldownMs, hintMs } = computeCooldown({
      res: makeRes({ "Retry-After": "8" }), bodyText: "", minMs: 100, maxMs: 200, hardCapMs: 60_000
    });
    assert.equal(hintMs, 8_000);
    assert.equal(cooldownMs, 8_000);
  });

  it("hardCapMs 를 초과하면 상한으로 잘린다", () => {
    const { cooldownMs } = computeCooldown({
      res: makeRes({ "Retry-After": "3600" }), bodyText: "", hardCapMs: 60_000
    });
    assert.equal(cooldownMs, 60_000);
  });

  it("디폴트 minMs=500, maxMs=2000, hardCapMs=60000 동작", () => {
    const { cooldownMs } = computeCooldown({ res: makeRes(), bodyText: "" });
    assert.ok(cooldownMs >= 500 && cooldownMs <= 2_000);
  });
});
