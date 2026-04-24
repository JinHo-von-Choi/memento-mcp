/**
 * LLM Dispatcher — Fallback Chain 진입점
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 *
 * LLM_PRIMARY → LLM_FALLBACKS 순서로 chain을 구성하고,
 * 첫 번째로 성공한 provider의 응답을 반환한다.
 * 모든 provider가 실패하면 Error를 throw한다.
 *
 * lib/gemini.js의 geminiCLIJson / isGeminiCLIAvailable이 이 모듈로 위임된다.
 * 기존 5개 caller (AutoReflect, MorphemeIndex, ConsolidatorGC,
 * ContradictionDetector, MemoryEvaluator)는 코드 변경 없이 계속 동작한다.
 */

import { LLM_PRIMARY, LLM_FALLBACKS, LLM_CONCURRENCY_ENABLED, LLM_CONCURRENCY_WAIT_MS, getConcurrencyLimit } from "../config.js";
import { createProvider }                                                                                       from "./registry.js";
import { redactPrompt }                                                                                         from "./util/redact-prompt.js";
import {
  llmProviderCallsTotal,
  llmProviderLatencyMs,
  llmFallbackTriggeredTotal,
  llmProviderConcurrencyActive,
  llmProviderConcurrencyWaitMs,
  llmProvider429Total
}                                                                                                               from "./metrics.js";
import { getSemaphore }                                                                                         from "./util/semaphore.js";
import { logWarn }                                                                                              from "../logger.js";
import { createHash }                                                                                           from "node:crypto";

// ---------------------------------------------------------------------------
// Chain 빌드
// ---------------------------------------------------------------------------

/**
 * provider 설정 객체(또는 문자열)로부터 dedup/세마포어용 chain key를 생성한다.
 *
 * @param {string | { provider: string, baseUrl?: string, model?: string }} providerConfig
 * @returns {string}
 */
function buildChainKey(providerConfig) {
  if (typeof providerConfig === "string") return providerConfig;
  /** apiKey가 있으면 sha256 앞 8자를 꼬리에 붙여, 동일 provider|baseUrl|model 조합이라도
   *  키별로 독립된 chain entry + semaphore로 구분한다. 키 원문은 노출되지 않는다. */
  const apiKeyTag = providerConfig.apiKey
    ? "|" + createHash("sha256").update(String(providerConfig.apiKey)).digest("hex").slice(0, 8)
    : "";
  return `${providerConfig.provider}|${providerConfig.baseUrl ?? ""}|${providerConfig.model ?? ""}${apiKeyTag}`;
}

/**
 * LLM_PRIMARY + LLM_FALLBACKS 로부터 사용 가능한 provider 체인을 구성한다.
 *
 * - 중복 provider는 첫 등장 기준으로 한 번만 포함한다.
 * - isAvailable() 체크에서 실패한 provider는 체인에서 제외한다.
 *
 * @returns {Promise<import("./LlmProvider.js").LlmProvider[]>}
 */
async function buildChain() {
  /** primary 설정 객체: primary가 fallback 목록에 있으면 해당 config 사용 */
  const primaryConfig = (() => {
    if (LLM_PRIMARY === "gemini-cli") return "gemini-cli";
    const fromFallbacks = LLM_FALLBACKS.find(f => f.provider === LLM_PRIMARY);
    return fromFallbacks ?? LLM_PRIMARY;
  })();

  const entries = [primaryConfig, ...LLM_FALLBACKS];
  const seen    = new Set();
  const chain   = [];

  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry?.provider;
    if (!name) continue;
    const key  = buildChainKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);

    const provider = createProvider(entry);
    if (!provider) continue;

    try {
      if (await provider.isAvailable()) {
        chain.push(provider);
      }
    } catch (err) {
      logWarn(`[llm] provider ${name} isAvailable check failed: ${err.message}`);
    }
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 프롬프트를 LLM chain에 전달하여 JSON 응답을 반환한다.
 *
 * - 프롬프트는 전송 전에 redactPrompt()로 민감 데이터를 마스킹한다.
 * - 모든 provider 실패 시 Error throw.
 *
 * @param {string} prompt
 * @param {object} [options={}]
 * @param {number}  [options.timeoutMs]
 * @param {number}  [options.maxTokens]
 * @param {number}  [options.temperature]
 * @param {string}  [options.model]
 * @param {string}  [options.systemPrompt]
 * @returns {Promise<*>} 파싱된 JSON 응답
 */
export async function llmJson(prompt, options = {}) {
  const safePrompt  = redactPrompt(prompt);
  const chain       = await buildChain();

  if (chain.length === 0) {
    throw new Error("no LLM provider available — check LLM_PRIMARY and LLM_FALLBACKS configuration");
  }

  const primaryName = chain[0].name;
  const errors      = [];

  for (const provider of chain) {
    const _t       = Date.now();
    /** chainKey는 dedupe 시점과 동일 규약을 재사용한다. apiKey 해시까지 포함하여
     *  동일 provider|baseUrl|model 조합에 여러 API 키가 있을 때 키별 독립 semaphore가 부여된다. */
    const chainKey = buildChainKey({
      provider: provider.name,
      baseUrl : provider.config?.baseUrl ?? "",
      model   : provider.config?.model   ?? "",
      apiKey  : provider.config?.apiKey  ?? provider.apiKey ?? null
    });
    llmProviderCallsTotal.inc({ provider: provider.name, outcome: "attempt" });

    // semaphore acquire
    if (LLM_CONCURRENCY_ENABLED) {
      const sem      = getSemaphore(chainKey, getConcurrencyLimit(chainKey, provider.name), LLM_CONCURRENCY_WAIT_MS);
      const waitStart = Date.now();
      try {
        await sem.acquire();
      } catch (err) {
        // timeout waiting for a slot — treat as provider failure, try next
        errors.push(`${provider.name}: semaphore wait timeout`);
        logWarn(`[llm] ${provider.name} semaphore timed out, trying next`);
        llmProviderCallsTotal.inc({ provider: provider.name, outcome: "failure" });
        continue;
      }
      llmProviderConcurrencyWaitMs.observe({ provider: provider.name }, Date.now() - waitStart);
      llmProviderConcurrencyActive.inc({ provider: provider.name });

      try {
        const result  = await provider.callJson(safePrompt, options);
        const latency = Date.now() - _t;

        llmProviderLatencyMs.observe({ provider: provider.name }, latency);
        llmProviderCallsTotal.inc({ provider: provider.name, outcome: "success" });

        if (provider.name !== primaryName) {
          llmFallbackTriggeredTotal.inc({ primary: primaryName, fallback: provider.name });
        }

        return result;
      } catch (err) {
        if ((err.message && err.message.includes("HTTP 429")) || err.name === "LlmRateLimitError") {
          llmProvider429Total.inc({ provider: provider.name });
        }
        llmProviderCallsTotal.inc({ provider: provider.name, outcome: "failure" });
        errors.push(`${provider.name}: ${err.message}`);
        logWarn(`[llm] ${provider.name} failed, trying next: ${err.message}`);
      } finally {
        llmProviderConcurrencyActive.dec({ provider: provider.name });
        sem.release();
      }
    } else {
      // concurrency disabled — direct passthrough
      try {
        const result  = await provider.callJson(safePrompt, options);
        const latency = Date.now() - _t;

        llmProviderLatencyMs.observe({ provider: provider.name }, latency);
        llmProviderCallsTotal.inc({ provider: provider.name, outcome: "success" });

        if (provider.name !== primaryName) {
          llmFallbackTriggeredTotal.inc({ primary: primaryName, fallback: provider.name });
        }

        return result;
      } catch (err) {
        if ((err.message && err.message.includes("HTTP 429")) || err.name === "LlmRateLimitError") {
          llmProvider429Total.inc({ provider: provider.name });
        }
        llmProviderCallsTotal.inc({ provider: provider.name, outcome: "failure" });
        errors.push(`${provider.name}: ${err.message}`);
        logWarn(`[llm] ${provider.name} failed, trying next: ${err.message}`);
      }
    }
  }

  throw new Error(`all LLM providers failed: ${errors.join("; ")}`);
}

/**
 * LLM chain에 사용 가능한 provider가 하나 이상 있는지 확인한다.
 *
 * @returns {Promise<boolean>}
 */
export async function isLlmAvailable() {
  const chain = await buildChain();
  return chain.length > 0;
}
