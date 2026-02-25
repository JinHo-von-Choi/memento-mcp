/**
 * Prometheus 메트릭
 *
 * 작성자: 최진호
 * 작성일: 2026-02-13
 */

import prometheus        from "prom-client";

/** 레지스트리 */
export const register    = new prometheus.Registry();

/** 기본 메트릭 활성화 (CPU, 메모리 등) */
prometheus.collectDefaultMetrics({
  register,
  prefix: "mcp_"
});

/** HTTP 요청 카운터 */
export const httpRequestsTotal = new prometheus.Counter({
  name      : "mcp_http_requests_total",
  help      : "Total number of HTTP requests",
  labelNames: ["method", "endpoint", "status"],
  registers : [register]
});

/** HTTP 요청 지속 시간 */
export const httpRequestDuration = new prometheus.Histogram({
  name      : "mcp_http_request_duration_seconds",
  help      : "HTTP request duration in seconds",
  labelNames: ["method", "endpoint", "status"],
  buckets   : [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers : [register]
});

/** JSON-RPC 메서드 호출 카운터 */
export const rpcMethodCalls = new prometheus.Counter({
  name      : "mcp_rpc_method_calls_total",
  help      : "Total number of JSON-RPC method calls",
  labelNames: ["method", "success"],
  registers : [register]
});

/** JSON-RPC 메서드 지속 시간 */
export const rpcMethodDuration = new prometheus.Histogram({
  name      : "mcp_rpc_method_duration_seconds",
  help      : "JSON-RPC method duration in seconds",
  labelNames: ["method"],
  buckets   : [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers : [register]
});

/** 도구 실행 카운터 */
export const toolExecutionsTotal = new prometheus.Counter({
  name      : "mcp_tool_executions_total",
  help      : "Total number of tool executions",
  labelNames: ["tool", "success"],
  registers : [register]
});

/** 도구 실행 지속 시간 */
export const toolExecutionDuration = new prometheus.Histogram({
  name      : "mcp_tool_execution_duration_seconds",
  help      : "Tool execution duration in seconds",
  labelNames: ["tool"],
  buckets   : [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
  registers : [register]
});

/** 활성 세션 수 (Streamable) */
export const activeSessionsStreamable = new prometheus.Gauge({
  name     : "mcp_active_sessions_streamable",
  help     : "Number of active Streamable HTTP sessions",
  registers: [register]
});

/** 활성 세션 수 (Legacy SSE) */
export const activeSessionsLegacy = new prometheus.Gauge({
  name     : "mcp_active_sessions_legacy",
  help     : "Number of active Legacy SSE sessions",
  registers: [register]
});

/** OAuth 토큰 발급 카운터 */
export const oauthTokensIssued = new prometheus.Counter({
  name      : "mcp_oauth_tokens_issued_total",
  help      : "Total number of OAuth tokens issued",
  labelNames: ["grant_type"],
  registers : [register]
});

/** OAuth 토큰 검증 카운터 */
export const oauthTokenValidations = new prometheus.Counter({
  name      : "mcp_oauth_token_validations_total",
  help      : "Total number of OAuth token validations",
  labelNames: ["result"],
  registers : [register]
});

/** 에러 카운터 */
export const errorsTotal = new prometheus.Counter({
  name      : "mcp_errors_total",
  help      : "Total number of errors",
  labelNames: ["type", "code"],
  registers : [register]
});

/** 프로토콜 버전 협상 카운터 */
export const protocolVersionNegotiations = new prometheus.Counter({
  name      : "mcp_protocol_version_negotiations_total",
  help      : "Total number of protocol version negotiations",
  labelNames: ["requested_version", "negotiated_version"],
  registers : [register]
});

/** 인증 시도 카운터 */
export const authenticationAttempts = new prometheus.Counter({
  name      : "mcp_authentication_attempts_total",
  help      : "Total number of authentication attempts",
  labelNames: ["method", "success"],
  registers : [register]
});

/**
 * 세션 수 업데이트
 */
export function updateSessionCounts(streamableCount, legacyCount) {
  activeSessionsStreamable.set(streamableCount);
  activeSessionsLegacy.set(legacyCount);
}

/**
 * HTTP 요청 기록
 */
export function recordHttpRequest(method, endpoint, statusCode, durationSeconds) {
  httpRequestsTotal.inc({
    method,
    endpoint,
    status: statusCode
  });

  httpRequestDuration.observe({
    method,
    endpoint,
    status: statusCode
  }, durationSeconds);
}

/**
 * RPC 메서드 호출 기록
 */
export function recordRpcMethod(method, success, durationSeconds) {
  rpcMethodCalls.inc({
    method,
    success: success ? "true" : "false"
  });

  rpcMethodDuration.observe({ method }, durationSeconds);
}

/**
 * 도구 실행 기록
 */
export function recordToolExecution(toolName, success, durationSeconds) {
  toolExecutionsTotal.inc({
    tool: toolName,
    success: success ? "true" : "false"
  });

  toolExecutionDuration.observe({ tool: toolName }, durationSeconds);
}

/**
 * 에러 기록
 */
export function recordError(errorType, errorCode) {
  errorsTotal.inc({
    type: errorType,
    code: String(errorCode)
  });
}

/**
 * 프로토콜 버전 협상 기록
 */
export function recordProtocolNegotiation(requestedVersion, negotiatedVersion) {
  protocolVersionNegotiations.inc({
    requested_version: requestedVersion || "none",
    negotiated_version: negotiatedVersion
  });
}

/**
 * 인증 시도 기록
 */
export function recordAuthenticationAttempt(method, success) {
  authenticationAttempts.inc({
    method,
    success: success ? "true" : "false"
  });
}

/**
 * OAuth 토큰 발급 기록
 */
export function recordOAuthTokenIssued(grantType) {
  oauthTokensIssued.inc({ grant_type: grantType });
}

/**
 * OAuth 토큰 검증 기록
 */
export function recordOAuthTokenValidation(isValid) {
  oauthTokenValidations.inc({
    result: isValid ? "valid" : "invalid"
  });
}
