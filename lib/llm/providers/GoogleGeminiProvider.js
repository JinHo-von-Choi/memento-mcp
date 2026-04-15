/**
 * Google Gemini API Provider (HTTP, REST)
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 *
 * POST /v1beta/models/{model}:generateContent?key={apiKey}
 * API 키는 URL 쿼리 파라미터로 전달 (헤더 방식과 다름).
 * Gemini CLI(gemini-cli provider)와 완전히 별개.
 *
 * Token usage 출처:
 *   - input tokens : data.usageMetadata.promptTokenCount
 *   - output tokens: data.usageMetadata.candidatesTokenCount
 */

import { LlmProvider }       from "../LlmProvider.js";
import { fetchWithTimeout }  from "../util/fetch-with-timeout.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GoogleGeminiProvider extends LlmProvider {
  constructor(config = {}) {
    super({ ...config, name: "google-gemini-api" });
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.apiKey  = config.apiKey;
  }

  /**
   * apiKey와 model이 모두 설정돼야 호출 가능.
   * model 하드코딩 없음 — config.model 부재 시 false 반환.
   *
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return Boolean(this.apiKey && this.config.model);
  }

  /**
   * Google Gemini generateContent API를 호출하여 텍스트 응답을 반환한다.
   *
   * @param {string}  prompt
   * @param {object}  [options={}]
   * @param {string}  [options.model]         - config.model override
   * @param {number}  [options.maxTokens=2048]
   * @param {number}  [options.temperature=0.2]
   * @param {string}  [options.systemPrompt]  - systemInstruction 필드로 전달
   * @param {number}  [options.timeoutMs=30000]
   * @returns {Promise<string>}
   */
  async callText(prompt, options = {}) {
    if (this.isCircuitOpen()) {
      throw new Error("google-gemini-api: circuit breaker open");
    }

    const model = options.model || this.config.model;

    const body = {
      contents: [{
        parts: [{ text: prompt }],
        role : "user"
      }],
      generationConfig: {
        maxOutputTokens: options.maxTokens  || 2048,
        temperature    : options.temperature ?? 0.2
      }
    };

    if (options.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }

    const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const extraHeaders = this.config.extraHeaders || {};

    try {
      const res = await fetchWithTimeout(
        url,
        {
          method : "POST",
          headers: {
            "Content-Type": "application/json",
            ...extraHeaders
          },
          body: JSON.stringify(body)
        },
        options.timeoutMs || 30000
      );

      if (!res.ok) {
        this.recordFailure();
        const errBody = await res.text();
        throw new Error(`google-gemini-api HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      if (!text) {
        this.recordFailure();
        throw new Error("google-gemini-api: empty response");
      }

      this.recordSuccess();
      return text;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
}
