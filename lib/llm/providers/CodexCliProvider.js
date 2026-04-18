/**
 * Codex CLI Provider (lib/codex.js 래핑 shim)
 *
 * 작성자: 최진호
 * 작성일: 2026-04-18
 *
 * 순환 의존성 방지 구조:
 *   CodexCliProvider.isAvailable()  → _rawIsCodexCLIAvailable (CLI 바이너리 체크만)
 *   CodexCliProvider.callJson()     → runCodexCLI (CLI 직접 호출)
 *   lib/codex.js public API         → llm/index.js (chain 전체 위임)
 *
 * codex exec는 CLI를 통해 최종 메시지(-o FILE)를 기록하므로:
 *   - callJson() : 정상 동작 (CLI 출력 → parseJsonResponse)
 *   - callText() : 미구현 — "use callJson" 에러 throw
 */

import { LlmProvider }                                           from "../LlmProvider.js";
import { parseJsonResponse }                                     from "../util/parse-json.js";
import { runCodexCLI, _rawIsCodexCLIAvailable }                 from "../../codex.js";

export class CodexCliProvider extends LlmProvider {
  constructor(config = {}) {
    super({ ...config, name: "codex-cli" });
  }

  /**
   * Codex CLI 바이너리(`codex`) 설치 여부로 가용성을 판단한다.
   * _rawIsCodexCLIAvailable을 사용하여 chain 재귀 체크를 방지한다.
   *
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return _rawIsCodexCLIAvailable();
  }

  /**
   * codex-cli는 JSON 전용이므로 callText는 미구현.
   *
   * @throws {Error} 항상 throw
   */
  async callText(_prompt, _options = {}) {
    throw new Error("codex-cli: use callJson (CLI returns parsed JSON)");
  }

  /**
   * runCodexCLI를 직접 호출하여 JSON 응답을 반환한다.
   * Circuit breaker 연동 포함.
   *
   * @param {string}  prompt
   * @param {object}  [options={}]
   * @param {number}  [options.timeoutMs=120000]
   * @param {string}  [options.model]
   * @param {string}  [options.systemPrompt] - prompt 앞에 prepend (CLI는 단일 입력이므로 병합)
   * @returns {Promise<*>} 파싱된 JSON
   */
  async callJson(prompt, options = {}) {
    if (await this.isCircuitOpen()) {
      throw new Error("codex-cli: circuit breaker open");
    }

    /** CLI는 system role을 별도로 받지 않으므로 prompt 앞에 prepend하여 동등 효과 달성 */
    const finalPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt;

    try {
      const raw    = await runCodexCLI("", finalPrompt, {
        timeoutMs: options.timeoutMs || 120_000,
        model    : options.model
      });
      const result = parseJsonResponse(raw);
      await this.recordSuccess();
      return result;
    } catch (err) {
      await this.recordFailure();
      throw err;
    }
  }
}
