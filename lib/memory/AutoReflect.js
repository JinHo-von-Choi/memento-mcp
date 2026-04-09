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
import { logDebug, logInfo, logWarn } from "../logger.js";

/** 빈 세션 판정 최소 지속시간 (밀리초) */
const MIN_SESSION_DURATION_MS = 30_000;

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

    /** skip 판정: 빈 세션 또는 사용자가 이미 명시적 remember로 파편을 저장한 세션 */
    if (_shouldSkipReflect(activity)) {
      logDebug(`[AutoReflect] Skipping reflect for session: ${sessionId}`);
      await SessionActivityTracker.markReflected(sessionId);
      return { count: 0, fragments: [], skipped: true, reason: "skip_gated" };
    }

    const mgr = MemoryManager.getInstance();

    if (await isGeminiCLIAvailable()) {
      return await _reflectWithGemini(mgr, sessionId, agentId, activity);
    }

    /** Gemini 불가 시: 저품질 메타 요약 생성 방지를 위해 reflect 스킵 */
    logDebug(`[AutoReflect] Gemini CLI unavailable, skipping reflect for session: ${sessionId}`);
    await SessionActivityTracker.markReflected(sessionId);
    return { count: 0, fragments: [], skipped: true, reason: "gemini_unavailable" };
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
  "open_questions": ["미해결 질문 1건만 서술"],
  "narrative_summary": "이 세션에서 무슨 일이 있었는지 3~5문장의 서사로 작성. 사실 나열이 아니라 이야기로 써라."
}

Additionally, write a 'narrative_summary' field: a 3-5 sentence narrative of what happened in this session, why certain decisions were made, and what the outcome was. Write it as a story, not a list of facts.

중요 규칙:
- summary는 배열. 항목 1개 = 독립 사실 1건 (1~2문장). 한 항목에 여러 사실 나열 금지.
- 모든 배열: 항목 1개 = 사실/결정/에러/절차 1건. 여러 내용을 한 항목에 나열 금지.
- 내용이 많으면 축약하지 말고 항목 수를 늘릴 것. 파편 수가 많아도 괜찮다.
- 각 항목은 독립 파편으로 저장되므로 원자적으로 작성해야 시맨틱 검색이 정확해진다.
- 해당 사항 없으면 빈 배열([])로 반환.
- summary는 반드시 포함 (최소 1개 항목).
- 검색 패턴이나 도구 사용 패턴에서 학습할 수 있는 인사이트가 있다면, 해당 항목 앞에 "LEARNING:" 접두사를 붙여라. 예: "LEARNING: keyword recall이 topic 필터와 함께 사용하면 정확도가 높아진다"`;

  try {
    const result = await geminiCLIJson(prompt, { timeoutMs: 30_000 });

    if (!result.summary) {
      logWarn(`[AutoReflect] Gemini returned no summary for session: ${sessionId}`);
      await SessionActivityTracker.markReflected(sessionId);
      return { count: 0, fragments: [], skipped: true, reason: "gemini_empty_result" };
    }

    const reflectResult = await mgr.reflect({
      sessionId,
      agentId,
      summary:             result.summary,
      decisions:           result.decisions || [],
      errors_resolved:     result.errors_resolved || [],
      new_procedures:      result.new_procedures || [],
      open_questions:      result.open_questions || [],
      narrative_summary:   result.narrative_summary || null
    });

    /** LEARNING: 접두사 항목의 source를 learning_extraction으로 설정 */
    if (reflectResult.fragments) {
      for (const item of reflectResult.fragments) {
        if (typeof item.content === "string" && item.content.startsWith("LEARNING:")) {
          item.source  = "learning_extraction";
          item.content = item.content.replace(/^LEARNING:\s*/, "");
        }
      }
    }

    await SessionActivityTracker.markReflected(sessionId);
    logInfo(`[AutoReflect] Gemini-based reflect completed for ${sessionId}: ${reflectResult.count} fragments`);
    return reflectResult;

  } catch (err) {
    logWarn(`[AutoReflect] Gemini summarization failed, skipping reflect: ${err.message}`);
    await SessionActivityTracker.markReflected(sessionId);
    return { count: 0, fragments: [], skipped: true, reason: "gemini_error" };
  }
}

/**
 * 빈 세션 판정
 *
 * 다음 조건 중 하나라도 해당하면 빈 세션으로 간주:
 * - 세션 활동 로그(toolCalls)가 0건
 * - 생성된 파편이 0개
 * - 세션 지속시간 < 30초
 */
function _isEmptySession(activity) {
  const hasNoToolCalls = !activity.toolCalls || Object.keys(activity.toolCalls).length === 0;
  const hasNoFragments = !activity.fragments || activity.fragments.length === 0;

  let isTooShort = false;
  if (activity.startedAt && activity.lastActivity) {
    const durationMs = new Date(activity.lastActivity) - new Date(activity.startedAt);
    isTooShort       = durationMs < MIN_SESSION_DURATION_MS;
  } else {
    /** startedAt 또는 lastActivity 누락 시 지속시간 판정 불가 → 초단 세션 취급 */
    isTooShort = true;
  }

  return hasNoToolCalls || hasNoFragments || isTooShort;
}

/**
 * reflect 스킵 판정 (빈 세션 OR 사용자가 이미 명시적 remember로 파편을 저장한 세션)
 *
 * 다음 중 하나라도 해당하면 skip:
 * - activity가 null/undefined
 * - _isEmptySession이 true (toolCalls 없음 OR duration 부족)
 * - fragments 배열 길이 >= 1 (이미 의미 있는 기록이 있으므로 중복 요약 불필요)
 *
 * 주의: _isEmptySession의 hasNoFragments 조건은 여기서 재사용하지 않는다.
 * fragments=0인 세션은 Gemini 요약 대상이므로 skip false를 반환해야 한다.
 *
 * @param {Object|null} activity
 * @returns {boolean}
 */
function _shouldSkipReflect(activity) {
  if (!activity) return true;

  /** toolCalls 없음 → 의미 없는 세션 */
  const hasNoToolCalls = !activity.toolCalls || Object.keys(activity.toolCalls).length === 0;
  if (hasNoToolCalls) return true;

  /** duration < 30초 → 초단 세션 */
  let isTooShort = false;
  if (activity.startedAt && activity.lastActivity) {
    const durationMs = new Date(activity.lastActivity) - new Date(activity.startedAt);
    isTooShort       = durationMs < MIN_SESSION_DURATION_MS;
  } else {
    isTooShort = true;
  }
  if (isTooShort) return true;

  /** 사용자가 이미 명시적 remember로 파편을 저장한 세션 → 중복 요약 불필요 */
  const explicitCount = Array.isArray(activity.fragments) ? activity.fragments.length : 0;
  if (explicitCount >= 1) return true;

  return false;
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

export { _isEmptySession, _shouldSkipReflect, MIN_SESSION_DURATION_MS };
