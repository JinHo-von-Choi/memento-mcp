/**
 * Ollama Provider (로컬 LLM 서버)
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 *
 * POST /api/chat — API 키 불필요.
 * baseUrl은 사용자가 반드시 config에 지정해야 한다.
 * baseUrl 미지정 시 isAvailable()=false → 체인에서 자동 제외.
 *
 * Token usage 출처:
 *   - input tokens : data.prompt_eval_count
 *   - output tokens: data.eval_count
 *
 * timeout 기본값 60000ms — 로컬 LLM cold start 시간 고려.
 */

import { LlmProvider }       from "../LlmProvider.js";
import { fetchWithTimeout }  from "../util/fetch-with-timeout.js";

export class OllamaProvider extends LlmProvider {
  constructor(config = {}) {
    super({ ...config, name: "ollama" });
    this.baseUrl = config.baseUrl;  // 기본값 없음 — 사용자 지정 필수
    this.apiKey  = config.apiKey;   // 선택 (Ollama 기본 무인증)
  }

  /**
   * baseUrl과 model이 모두 설정돼야 호출 가능.
   * apiKey는 선택 — Ollama는 기본적으로 인증 불필요.
   *
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return Boolean(this.baseUrl && this.config.model);
  }

  /**
   * Ollama /api/chat 엔드포인트를 호출하여 텍스트 응답을 반환한다.
   *
   * @param {string}  prompt
   * @param {object}  [options={}]
   * @param {string}  [options.model]          - config.model override
   * @param {number}  [options.maxTokens=2048]
   * @param {number}  [options.temperature=0.2]
   * @param {string}  [options.systemPrompt]
   * @param {number}  [options.timeoutMs=60000] - cold start 고려 기본 60초
   * @returns {Promise<string>}
   */
  async callText(prompt, options = {}) {
    if (await this.isCircuitOpen()) {
      throw new Error("ollama: circuit breaker open");
    }

    const model    = options.model || this.config.model;
    const messages = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const body = {
      model  : model,
      messages,
      stream : false,
      options: {
        num_predict: options.maxTokens  || 2048,
        temperature: options.temperature ?? 0.2
      }
    };

    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const extraHeaders = this.config.extraHeaders || {};

    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/api/chat`,
        {
          method : "POST",
          headers: { ...headers, ...extraHeaders },
          body   : JSON.stringify(body)
        },
        options.timeoutMs || 60000
      );

      if (!res.ok) {
        this.recordFailure();
        const errBody = await res.text();
        throw new Error(`ollama HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      }

      const data = await res.json();
      const text = data.message?.content ?? "";

      if (!text) {
        this.recordFailure();
        throw new Error("ollama: empty response");
      }

      this.recordSuccess();
      return text;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
}
