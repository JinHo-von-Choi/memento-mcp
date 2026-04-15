/**
 * AbortController 기반 fetch 타임아웃 래퍼
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 */

import { LlmTimeoutError } from "../errors.js";

/**
 * 지정된 시간 내에 fetch를 완료하지 못하면 AbortController로 요청을 취소한다.
 *
 * @param {string}  url
 * @param {object}  [options={}]     - fetch 옵션 (signal 제외)
 * @param {number}  [timeoutMs=30000]
 * @returns {Promise<Response>}
 * @throws {LlmTimeoutError} 타임아웃 경과 시
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new LlmTimeoutError(
        `Request to ${url} timed out after ${timeoutMs}ms`,
        { url, timeoutMs }
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
