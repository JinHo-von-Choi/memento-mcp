/**
 * Anthropic Claude Provider (Messages API)
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 *
 * POST /v1/messages — x-api-key + anthropic-version 헤더.
 * system 프롬프트는 별도 최상위 필드로 전달 (messages 배열 외부).
 *
 * Token usage 출처:
 *   - input tokens : data.usage.input_tokens
 *   - output tokens: data.usage.output_tokens
 */

import { LlmProvider }       from "../LlmProvider.js";
import { fetchWithTimeout }  from "../util/fetch-with-timeout.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_VERSION  = "2023-06-01";

export class AnthropicProvider extends LlmProvider {
  constructor(config = {}) {
    super({ ...config, name: "anthropic" });
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.apiKey  = config.apiKey;
    this.version = config.version || DEFAULT_VERSION;
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
   * Anthropic Messages API를 호출하여 텍스트 응답을 반환한다.
   *
   * @param {string}  prompt
   * @param {object}  [options={}]
   * @param {string}  [options.model]         - config.model override
   * @param {number}  [options.maxTokens=2048]
   * @param {number}  [options.temperature=0.2]
   * @param {string}  [options.systemPrompt]  - system 필드로 전달
   * @param {number}  [options.timeoutMs=30000]
   * @returns {Promise<string>}
   */
  async callText(prompt, options = {}) {
    if (await this.isCircuitOpen()) {
      throw new Error("anthropic: circuit breaker open");
    }

    const model = options.model || this.config.model;

    const body = {
      model      : model,
      max_tokens : options.maxTokens  || 2048,
      temperature: options.temperature ?? 0.2,
      messages   : [{ role: "user", content: prompt }]
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    const extraHeaders = this.config.extraHeaders || {};

    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/messages`,
        {
          method : "POST",
          headers: {
            "Content-Type"     : "application/json",
            "x-api-key"        : this.apiKey,
            "anthropic-version": this.version,
            ...extraHeaders
          },
          body: JSON.stringify(body)
        },
        options.timeoutMs || 30000
      );

      if (!res.ok) {
        this.recordFailure();
        const errBody = await res.text();
        throw new Error(`anthropic HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      }

      const data  = await res.json();
      const text  = data.content?.[0]?.text ?? "";

      if (!text) {
        this.recordFailure();
        throw new Error("anthropic: empty response");
      }

      this.recordSuccess();
      return text;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
}
