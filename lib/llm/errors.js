/**
 * LLM Provider 에러 계층
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 */

/**
 * LLM 호출 기본 에러.
 * 모든 provider 에러의 공통 기반 클래스.
 */
export class LlmError extends Error {
  constructor(msg, meta = {}) {
    super(msg);
    this.name = "LlmError";
    this.meta = meta;
  }
}

/**
 * 네트워크/AbortController 타임아웃 에러.
 * 폴백 가능 — 다음 provider로 계속 진행.
 */
export class LlmTimeoutError extends LlmError {
  constructor(msg, meta = {}) {
    super(msg, meta);
    this.name = "LlmTimeoutError";
  }
}

/**
 * HTTP 429 Rate limit 에러.
 * 폴백 가능 — 다음 provider로 계속 진행.
 */
export class LlmRateLimitError extends LlmError {
  constructor(msg, meta = {}) {
    super(msg, meta);
    this.name = "LlmRateLimitError";
  }
}

/**
 * HTTP 401/403 인증/인가 에러.
 * 해당 provider만 건너뛰고 폴백 계속 진행.
 */
export class LlmAuthError extends LlmError {
  constructor(msg, meta = {}) {
    super(msg, meta);
    this.name = "LlmAuthError";
  }
}

/**
 * 컨텍스트 윈도우 초과, 잘못된 모델명, 사용자 취소 등
 * 즉시 전파해야 하는 치명적 에러. 폴백 불가.
 */
export class LlmFatalError extends LlmError {
  constructor(msg, meta = {}) {
    super(msg, meta);
    this.name = "LlmFatalError";
  }
}
