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
    console.warn(`[AutoReflect] Failed for session ${sessionId}: ${err.message}`);
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

  const prompt = `다음 AI 에이전트 세션 활동 로그를 분석하여 구조화된 요약을 생성하라.

세션 ID: ${sessionId}
소요 시간: ${duration}
도구 사용: ${toolSummary}
검색 키워드: ${kwList || "없음"}
생성/접근한 파편 수: ${fragCount}

다음 JSON 형식으로 응답하라:
{
  "summary": "세션에서 수행한 작업 1-2문장 요약",
  "decisions": ["내려진 기술/아키텍처 결정 (있다면)"],
  "errors_resolved": ["해결된 에러 (있다면)"],
  "new_procedures": ["확립된 새 절차 (있다면)"],
  "open_questions": ["미해결 질문 (있다면)"]
}

활동이 단순하면 decisions/errors_resolved/new_procedures/open_questions는 빈 배열로 반환.
summary는 반드시 포함하라.`;

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
    console.log(`[AutoReflect] Gemini-based reflect completed for ${sessionId}: ${reflectResult.count} fragments`);
    return reflectResult;

  } catch (err) {
    console.warn(`[AutoReflect] Gemini summarization failed, falling back to minimal: ${err.message}`);
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
  console.log(`[AutoReflect] Minimal reflect completed for ${sessionId}: ${reflectResult.count} fragments`);
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
