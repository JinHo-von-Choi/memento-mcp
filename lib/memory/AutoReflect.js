/**
 * AutoReflect - 세션 종료 시 자동 reflect 오케스트레이터
 *
 * 작성자: 최진호
 * 작성일: 2026-02-28
 *
 * 세션 종료/만료 시점에 SessionActivityTracker 로그를 기반으로
 * MemoryManager.reflect()를 자동 호출한다.
 *
 * Gemini CLI 가용 시: 활동 로그 기반 구조화 요약 생성 후 reflect
 * Gemini CLI 불가 시: 최소 fact 파편(세션 메타데이터)만 생성
 */

import { SessionActivityTracker } from "./SessionActivityTracker.js";
import { MemoryManager } from "./MemoryManager.js";
import { geminiCLIJson, isGeminiCLIAvailable } from "../gemini.js";
import { logInfo, logWarn } from "../logger.js";

/**
 * 세션에 대한 자동 reflect 수행
 *
 * @param {string} sessionId
 * @param {string} [agentId="default"]
 * @returns {Promise<Object|null>} reflect 결과 또는 null
 */
export async function autoReflect(sessionId, agentId = "default") {
  if (!sessionId) return null;

  try {
    const activity = await SessionActivityTracker.getActivity(sessionId);

    /** 활동 로그가 없거나 이미 reflected 상태 */
    if (!activity || activity.reflected) return null;

    /** 도구 호출이 없는 빈 세션은 스킵 */
    if (!activity.toolCalls || Object.keys(activity.toolCalls).length === 0) {
      await SessionActivityTracker.markReflected(sessionId);
      return null;
    }

    const mgr = MemoryManager.getInstance();

    if (await isGeminiCLIAvailable()) {
      return await _reflectWithGemini(mgr, sessionId, agentId, activity);
    }

    return await _reflectMinimal(mgr, sessionId, agentId, activity);
  } catch (err) {
    logWarn(`[AutoReflect] Failed for session ${sessionId}: ${err.message}`);
    return null;
  }
}

/**
 * Gemini CLI 기반 구조화 요약 reflect
 */
async function _reflectWithGemini(mgr, sessionId, agentId, activity) {
  const toolSummary = Object.entries(activity.toolCalls)
    .map(([tool, count]) => `${tool}: ${count}회`)
    .join(", ");

  const kwList   = (activity.keywords || []).slice(0, 20).join(", ");
  const fragCount = (activity.fragments || []).length;
  const duration  = _calcDuration(activity.startedAt, activity.lastActivity);

  const prompt = `다음 AI 에이전트 세션 활동 로그를 분석하여 구조화된 기억 파편을 생성하라.

세션 ID: ${sessionId}
소요 시간: ${duration}
도구 사용: ${toolSummary}
검색 키워드: ${kwList || "없음"}
생성/접근한 파편 수: ${fragCount}

다음 JSON 형식으로 응답하라:
{
  "summary": ["세션에서 수행한 작업을 1~2문장짜리 항목으로 쪼갠 배열. 항목 1개 = 사실 1건"],
  "decisions": ["결정 1건만 서술", "결정 2건만 서술"],
  "errors_resolved": ["원인: X → 해결: Y 형식으로 에러 1건만 서술"],
  "new_procedures": ["절차 1개만 서술"],
  "open_questions": ["미해결 질문 1건만 서술"]
}

중요 규칙:
- summary는 배열. 항목 1개 = 독립 사실 1건 (1~2문장). 한 항목에 여러 사실 나열 금지.
- 모든 배열: 항목 1개 = 사실/결정/에러/절차 1건. 여러 내용을 한 항목에 나열 금지.
- 내용이 많으면 축약하지 말고 항목 수를 늘릴 것. 파편 수가 많아도 괜찮다.
- 각 항목은 독립 파편으로 저장되므로 원자적으로 작성해야 시맨틱 검색이 정확해진다.
- 해당 사항 없으면 빈 배열([])로 반환.
- summary는 반드시 포함 (최소 1개 항목).`;

  try {
    const result = await geminiCLIJson(prompt, { timeoutMs: 30_000 });

    if (!result.summary) {
      return await _reflectMinimal(mgr, sessionId, agentId, activity);
    }

    const reflectResult = await mgr.reflect({
      sessionId,
      agentId,
      summary:          result.summary,
      decisions:        result.decisions || [],
      errors_resolved:  result.errors_resolved || [],
      new_procedures:   result.new_procedures || [],
      open_questions:   result.open_questions || []
    });

    await SessionActivityTracker.markReflected(sessionId);
    logInfo(`[AutoReflect] Gemini-based reflect completed for ${sessionId}: ${reflectResult.count} fragments`);
    return reflectResult;

  } catch (err) {
    logWarn(`[AutoReflect] Gemini summarization failed, falling back to minimal: ${err.message}`);
    return await _reflectMinimal(mgr, sessionId, agentId, activity);
  }
}

/**
 * Gemini CLI 불가 시 최소 reflect (메타데이터 fact 파편만 생성)
 */
async function _reflectMinimal(mgr, sessionId, agentId, activity) {
  const toolSummary = Object.entries(activity.toolCalls || {})
    .map(([tool, count]) => `${tool}(${count})`)
    .join(", ");

  const fragCount = (activity.fragments || []).length;
  const duration  = _calcDuration(activity.startedAt, activity.lastActivity);

  const summary = `세션 ${sessionId.substring(0, 8)}... 자동 요약: ${duration} 동안 도구 ${toolSummary} 사용, 파편 ${fragCount}개 처리.`;

  const reflectResult = await mgr.reflect({
    sessionId,
    agentId,
    summary
  });

  await SessionActivityTracker.markReflected(sessionId);
  logInfo(`[AutoReflect] Minimal reflect completed for ${sessionId}: ${reflectResult.count} fragments`);
  return reflectResult;
}

/**
 * 세션 소요 시간 계산
 */
function _calcDuration(startedAt, lastActivity) {
  if (!startedAt || !lastActivity) return "알 수 없음";

  const ms   = new Date(lastActivity) - new Date(startedAt);
  const mins = Math.floor(ms / 60000);

  if (mins < 1) return "1분 미만";
  if (mins < 60) return `${mins}분`;

  const hours = Math.floor(mins / 60);
  const rem   = mins % 60;
  return `${hours}시간 ${rem}분`;
}
