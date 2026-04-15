/**
 * LLM 프롬프트 민감 데이터 마스킹
 *
 * 옵션 B (패턴 기반) 구현.
 * lib/logger.js의 REDACT_PATTERNS는 현재 로컬 const이며 export되지 않음.
 * Task 10 완료 후 lib/logger.js에서 REDACT_PATTERNS + redactString을 export하면
 * 이 파일을 import 재사용으로 리팩터링할 것.
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 */

// ---------------------------------------------------------------------------
// 패턴 복사 (lib/logger.js의 REDACT_PATTERNS와 동일)
// Task 10 완료 후 import { REDACT_PATTERNS, redactString } from "../../logger.js" 로 전환 예정
// ---------------------------------------------------------------------------

const REDACT_PATTERNS = [
  /** Authorization: Bearer <token> */
  { pattern: /(Authorization\s*[:=]\s*Bearer\s+)\S+/gi,   replacement: "$1****"    },
  /** Bearer <token> 값 단독 형태 */
  { pattern: /^(Bearer\s+)\S+$/i,                          replacement: "$1****"    },
  /** mmcp_session 쿠키 값 */
  { pattern: /(mmcp_session\s*=\s*)[^;\s"]+/g,             replacement: "$1****"    },
  /** mmcp_ API 키 패턴 */
  { pattern: /\bmmcp_(?!session\s*=)[A-Za-z0-9_-]+/g,     replacement: "mmcp_****" },
  /** OAuth code 파라미터 */
  { pattern: /("code"\s*:\s*")[^"]+"/g,                    replacement: "$1****\""  },
  /** OAuth refresh_token 파라미터 */
  { pattern: /("refresh_token"\s*:\s*")[^"]+"/g,           replacement: "$1****\""  },
  /** OAuth access_token 파라미터 */
  { pattern: /("access_token"\s*:\s*")[^"]+"/g,            replacement: "$1****\""  },
  /** 일반적인 API 키 패턴: sk-, gsk_, sk-ant- 등 */
  { pattern: /\b(sk-ant-|sk-|gsk_)[A-Za-z0-9_-]{8,}/g,   replacement: "$1****"    },
];

/**
 * 프롬프트 텍스트에서 민감 패턴을 마스킹한다.
 *
 * @param {string} text - 원본 프롬프트 텍스트
 * @returns {string}    - 마스킹된 텍스트
 */
export function redactPrompt(text) {
  if (!text || typeof text !== "string") return text;
  let result = text;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
