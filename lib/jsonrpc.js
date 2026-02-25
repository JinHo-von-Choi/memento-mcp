/**
 * JSON-RPC 핸들러
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 */

import { SUPPORTED_PROTOCOL_VERSIONS, DEFAULT_PROTOCOL_VERSION } from "./config.js";
import { getToolsDefinition } from "./tools/index.js";
import { TOOL_REGISTRY }     from "./tool-registry.js";
import {
  recordRpcMethod,
  recordToolExecution,
  recordProtocolNegotiation,
  recordError
} from "./metrics.js";

/**
 * JSON-RPC 에러 응답 생성
 */
export function jsonRpcError(id, code, message, data) {
  const err                = { code, message };

  if (data !== undefined) {
    err.data             = data;
  }

  return {
    jsonrpc: "2.0",
    id,
    error : err
  };
}

/**
 * JSON-RPC 성공 응답 생성
 */
export function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

/**
 * 프로토콜 버전 협상
 * 클라이언트가 요청한 버전과 서버가 지원하는 버전을 비교하여 최적 버전 선택
 *
 * @param {string|undefined} clientVersion - 클라이언트가 요청한 프로토콜 버전
 * @returns {string} - 협상된 프로토콜 버전
 */
function negotiateProtocolVersion(clientVersion) {
  // 클라이언트가 버전을 명시하지 않은 경우 기본 버전 사용
  if (!clientVersion) {
    console.log(`[Protocol] Client did not specify version, using default: ${DEFAULT_PROTOCOL_VERSION}`);
    return DEFAULT_PROTOCOL_VERSION;
  }

  // 클라이언트가 요청한 버전을 서버가 지원하는 경우 해당 버전 사용
  if (SUPPORTED_PROTOCOL_VERSIONS.includes(clientVersion)) {
    console.log(`[Protocol] Client requested ${clientVersion}, supported - using requested version`);
    return clientVersion;
  }

  // 클라이언트가 요청한 버전을 서버가 지원하지 않는 경우
  // 날짜 기반으로 가장 가까운 하위 버전 선택
  const clientDate         = new Date(clientVersion);
  let fallbackVersion    = null;

  for (const supportedVersion of SUPPORTED_PROTOCOL_VERSIONS) {
    const supportedDate    = new Date(supportedVersion);

    // 클라이언트 요청 버전보다 이전 버전 중 가장 최신 버전 선택
    if (supportedDate <= clientDate) {
      fallbackVersion    = supportedVersion;
      break;
    }
  }

  // 클라이언트 요청 버전보다 이전 버전이 없는 경우 (모든 지원 버전보다 오래된 경우)
  // 가장 오래된 지원 버전 사용
  if (!fallbackVersion) {
    fallbackVersion      = SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];
    console.log(`[Protocol] Client requested ${clientVersion}, older than all supported - using oldest: ${fallbackVersion}`);
  } else {
    console.log(`[Protocol] Client requested ${clientVersion}, not supported - falling back to ${fallbackVersion}`);
  }

  return fallbackVersion;
}

/**
 * README.md 읽기 (환영 메시지용)
 */
/**
 * initialize 핸들러
 */
export async function handleInitialize(params) {
  const startTime        = process.hrtime.bigint();

  try {
    // 클라이언트가 요청한 프로토콜 버전 확인
    const clientVersion      = params?.protocolVersion;
    const negotiatedVersion  = negotiateProtocolVersion(clientVersion);

    // 프로토콜 버전 협상 메트릭 기록
    recordProtocolNegotiation(clientVersion, negotiatedVersion);

    const aiInstructions     = `# Memento MCP Server

연결 성공. Fragment-Based Memory 시스템.

주요 도구:
- remember: 파편 기억 저장 (fact/decision/error/preference/procedure/relation)
- recall: 기억 검색 (키워드, 주제, 시맨틱 검색)
- forget: 기억 삭제
- link: 파편 간 관계 설정
- amend: 기억 수정
- reflect: 세션 요약 저장
- context: Core/Working Memory 로드
- tool_feedback: 도구 유용성 피드백
- memory_stats: 메모리 통계
- memory_consolidate: 메모리 유지보수
- graph_explore: 에러 인과 관계 추적 (RCA)

프로토콜 버전: ${negotiatedVersion}
지원 버전: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`;

    const result = {
      protocolVersion: negotiatedVersion,
      serverInfo     : {
        name       : "memento-mcp-server",
        version    : "1.0.0",
        description: `Memento MCP - Fragment-Based Memory Server (도구 11개)

주요 기능:
- 파편 기반 기억 시스템 (Fragment-Based Memory)
- 시맨틱 검색 (OpenAI Embedding + pgvector)
- Core Memory / Working Memory 분리
- TTL 기반 기억 계층 관리
- 에러 인과 관계 그래프 (RCA)

지원 프로토콜: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`
      },
      capabilities   : {
        tools: { listChanged: false }
      },
      instructions   : aiInstructions
    };

    // RPC 메서드 호출 메트릭 기록
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    recordRpcMethod("initialize", true, duration);

    return result;
  } catch (err) {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    recordRpcMethod("initialize", false, duration);
    throw err;
  }
}

/**
 * tools/list 핸들러
 */
export function handleToolsList(_params) {
  const startTime        = process.hrtime.bigint();

  try {
    const result = {
      tools: getToolsDefinition()
    };

    // nextCursor가 null이면 생략 (엄격한 클라이언트 유효성 검사 대응)
    const nextCursor = _params?.cursor ? null : null; // 실제 페이징 미구현 상태
    if (nextCursor) {
      result.nextCursor = nextCursor;
    }

    // RPC 메서드 호출 메트릭 기록
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    recordRpcMethod("tools/list", true, duration);

    return result;
  } catch (err) {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    recordRpcMethod("tools/list", false, duration);
    throw err;
  }
}

/**
 * tools/call 핸들러
 */
export async function handleToolsCall(params) {
  const startTime        = process.hrtime.bigint();

  if (!params || typeof params.name !== "string") {
    throw new Error("Tool name is required");
  }

  const name             = params.name;
  const args             = params.arguments || {};

  const entry            = TOOL_REGISTRY.get(name);

  if (!entry) {
    const error          = new Error(`Unknown tool: ${name}`);
    error.code           = -32601;
    throw error;
  }

  const toolResult       = await entry.handler(args);

  // post-processing (예: get_doc → updateAccessStats)
  if (entry.post) {
    entry.post(args, toolResult);
  }

  // 로그 출력
  if (entry.log) {
    const message        = entry.log(args, toolResult);
    if (message) {
      console.log(`[Tool] ${message}`);
    }
  }

  // 도구 실행 메트릭
  const toolDuration     = Number(process.hrtime.bigint() - startTime) / 1e9;
  recordToolExecution(name, true, toolDuration);

  // 커스텀 응답 포맷 (예: send_sms)
  if (entry.formatResponse) {
    const rpcDuration    = Number(process.hrtime.bigint() - startTime) / 1e9;
    recordRpcMethod("tools/call", true, rpcDuration);
    return entry.formatResponse(args, toolResult);
  }

  // 기본 응답 포맷
  const rpcDuration      = Number(process.hrtime.bigint() - startTime) / 1e9;
  recordRpcMethod("tools/call", true, rpcDuration);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(toolResult, null, 2)
      }
    ],
    isError: Boolean(toolResult?.isError)
  };
}

/**
 * JSON-RPC 요청 디스패처
 */
export async function dispatchJsonRpc(msg) {
  if (!msg || typeof msg !== "object") {
    return { kind: "error", response: jsonRpcError(null, -32600, "Invalid Request") };
  }

  const jsonrpc             = msg.jsonrpc || "2.0";
  const id                  = Object.prototype.hasOwnProperty.call(msg, "id") ? msg.id : undefined;
  const method              = msg.method;
  const params              = msg.params;

  if (jsonrpc !== "2.0") {
    return { kind: "error", response: jsonRpcError(id ?? null, -32600, "Invalid Request", "jsonrpc must be '2.0'") };
  }

  if (typeof method !== "string") {
    return { kind: "error", response: jsonRpcError(id ?? null, -32600, "Invalid Request", "method must be string") };
  }

  const isNotification       = id === undefined;

  try {
    if (method === "initialize") {
      const result           = await handleInitialize(params);

      if (isNotification) {
        return { kind: "accepted" };
      }
      return { kind: "ok", response: jsonRpcResult(id, result) };
    }

    if (method === "tools/list") {
      const result           = handleToolsList(params);

      if (isNotification) {
        return { kind: "accepted" };
      }
      return { kind: "ok", response: jsonRpcResult(id, result) };
    }

    if (method === "tools/call") {
      const result           = await handleToolsCall(params);

      if (isNotification) {
        return { kind: "accepted" };
      }
      return { kind: "ok", response: jsonRpcResult(id, result) };
    }

    if (method === "notifications/initialized") {
      return { kind: "accepted" };
    }

    if (isNotification) {
      return { kind: "accepted" };
    }

    return { kind: "ok", response: jsonRpcError(id, -32601, `Method not found: ${method}`) };
  } catch (err) {
    if (isNotification) {
      return { kind: "accepted" };
    }

    console.error(`[ERROR] ${method}:`, err);
    const errorCode        = err.code || -32603;
    const errorMessage     = errorCode === -32601 ? err.message : "Internal error";

    // 에러 메트릭 기록
    recordError(method, errorCode);

    return { kind: "ok", response: jsonRpcError(id, errorCode, errorMessage) };
  }
}
