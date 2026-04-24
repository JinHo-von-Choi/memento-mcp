/**
 * LLM Provider 429 쿨다운 로직 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-04-24
 *
 * OllamaProvider, OpenAICompatibleProvider 양쪽의
 * _setCooldown / isAvailable 연동을 검증한다.
 * HTTP 호출 없음 — 인스턴스 직접 생성 + 메서드 호출만 수행.
 */

import { test, describe } from "node:test";
import assert              from "node:assert/strict";

import { OllamaProvider }            from "../../lib/llm/providers/OllamaProvider.js";
import { OpenAICompatibleProvider }  from "../../lib/llm/providers/OpenAICompatibleProvider.js";
import { circuitBreaker }            from "../../lib/llm/util/circuit-breaker.js";

/**
 * Promise 기반 sleep 헬퍼.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// OllamaProvider 테스트
// ---------------------------------------------------------------------------

describe("OllamaProvider — 429 쿨다운", () => {
  test("초기 상태: baseUrl+model 설정 시 isAvailable() = true", async () => {
    const provider = new OllamaProvider({ baseUrl: "http://localhost:1", model: "test" });
    const result   = await provider.isAvailable();
    assert.equal(result, true);
  });

  test("_setCooldown(100) 직후 isAvailable() = false", async () => {
    const provider = new OllamaProvider({ baseUrl: "http://localhost:1", model: "test" });
    provider._setCooldown(100);
    const result = await provider.isAvailable();
    assert.equal(result, false);
  });

  test("쿨다운(100ms) 만료 후 150ms 대기 시 isAvailable() = true", async () => {
    const provider = new OllamaProvider({ baseUrl: "http://localhost:1", model: "test" });
    provider._setCooldown(100);
    await sleep(150);
    const result = await provider.isAvailable();
    assert.equal(result, true);
  });
});

// ---------------------------------------------------------------------------
// OpenAICompatibleProvider 테스트
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProvider — 429 쿨다운", () => {
  test("초기 상태: apiKey+baseUrl+model 설정 시 isAvailable() = true", async () => {
    const provider = new OpenAICompatibleProvider({
      name   : "test-openai",
      apiKey : "sk-test",
      baseUrl: "https://api.example.com/v1",
      model  : "test-model"
    });
    // circuit breaker를 리셋하여 깨끗한 상태로 시작
    await circuitBreaker.reset("test-openai");
    const result = await provider.isAvailable();
    assert.equal(result, true);
  });

  test("_setCooldown(100) 직후 isAvailable() = false", async () => {
    const provider = new OpenAICompatibleProvider({
      name   : "test-openai-cooldown",
      apiKey : "sk-test",
      baseUrl: "https://api.example.com/v1",
      model  : "test-model"
    });
    await circuitBreaker.reset("test-openai-cooldown");
    provider._setCooldown(100);
    const result = await provider.isAvailable();
    assert.equal(result, false);
  });

  test("쿨다운(100ms) 만료 후 150ms 대기 시 isAvailable() = true", async () => {
    const provider = new OpenAICompatibleProvider({
      name   : "test-openai-expired",
      apiKey : "sk-test",
      baseUrl: "https://api.example.com/v1",
      model  : "test-model"
    });
    await circuitBreaker.reset("test-openai-expired");
    provider._setCooldown(100);
    await sleep(150);
    const result = await provider.isAvailable();
    assert.equal(result, true);
  });
});
