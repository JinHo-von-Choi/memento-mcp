/**
 * LLM 응답에서 JSON을 robust하게 파싱하는 유틸리티
 *
 * 많은 provider가 응답을 ```json 코드 블록으로 감싸거나 앞뒤에 설명 텍스트를 추가한다.
 * 4단계 휴리스틱으로 파싱을 시도한다.
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 */

/**
 * LLM 텍스트 응답에서 JSON을 파싱한다.
 * 4단계 휴리스틱 순서:
 *  1. 직접 JSON.parse
 *  2. markdown 코드 펜스(```json ... ```) 제거 후 파싱
 *  3. 첫 `{` ~ 마지막 `}` 추출 후 파싱
 *  4. 첫 `[` ~ 마지막 `]` 추출 후 파싱 (배열 응답)
 *
 * @param {string} text - LLM 원시 텍스트 응답
 * @returns {*} 파싱된 JavaScript 값
 * @throws {Error} 모든 휴리스틱 실패 시
 */
export function parseJsonResponse(text) {
  if (!text || typeof text !== "string") {
    throw new Error("empty LLM response");
  }

  // 1. 직접 파싱
  try { return JSON.parse(text); } catch {}

  // 2. markdown 코드 펜스 제거
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // 3. 첫 { ~ 마지막 } 추출 (객체 응답)
  const firstBrace = text.indexOf("{");
  const lastBrace  = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch {}
  }

  // 4. 첫 [ ~ 마지막 ] 추출 (배열 응답)
  const firstBracket = text.indexOf("[");
  const lastBracket  = text.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try { return JSON.parse(text.slice(firstBracket, lastBracket + 1)); } catch {}
  }

  throw new Error(`failed to parse JSON from LLM response: ${text.slice(0, 200)}`);
}
