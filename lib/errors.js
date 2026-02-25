/**
 * 에러 클래스 계층 구조
 *
 * 작성자: 최진호
 * 작성일: 2026-02-13
 */

/** 기본 에러 클래스 */
export class McpError extends Error {
  constructor(message, code = -32603, data = null) {
    super(message);
    this.name         = this.constructor.name;
    this.code         = code;
    this.data         = data;
    this.timestamp    = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code   : this.code,
      message: this.message,
      data   : this.data
    };
  }
}

/** 검증 에러 */
export class ValidationError extends McpError {
  constructor(message, details = null) {
    super(message, -32602, details);
  }
}

/** 인증 에러 */
export class AuthenticationError extends McpError {
  constructor(message = "Authentication failed") {
    super(message, -32000);
  }
}

/** 권한 에러 */
export class AuthorizationError extends McpError {
  constructor(message = "Access denied") {
    super(message, -32001);
  }
}

/** 리소스 없음 */
export class NotFoundError extends McpError {
  constructor(resource, identifier) {
    super(`${resource} not found: ${identifier}`, -32002);
  }
}

/** Rate Limit 초과 */
export class RateLimitError extends McpError {
  constructor(retryAfter) {
    super("Rate limit exceeded", -32003, { retryAfter });
  }
}

/** 내부 서버 에러 */
export class InternalError extends McpError {
  constructor(message = "Internal server error") {
    super(message, -32603);
  }
}

/** 외부 서비스 에러 */
export class ExternalServiceError extends McpError {
  constructor(service, message) {
    super(`External service error: ${service}`, -32004, { message });
  }
}

/** 타임아웃 에러 */
export class TimeoutError extends McpError {
  constructor(operation) {
    super(`Operation timeout: ${operation}`, -32005);
  }
}

/** 잘못된 요청 */
export class BadRequestError extends McpError {
  constructor(message = "Bad request") {
    super(message, -32600);
  }
}

/** 메서드를 찾을 수 없음 */
export class MethodNotFoundError extends McpError {
  constructor(method) {
    super(`Method not found: ${method}`, -32601);
  }
}
