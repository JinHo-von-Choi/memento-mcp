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

    /** 빈 세션 필터: 노이즈 파편("파편 0개 처리") 생성 방지 */
    if (_isEmptySession(activity)) {
      logDebug(`[AutoReflect] Skipping empty session: ${sessionId}`);
      await SessionActivityTracker.markReflected(sessionId);
      return { count: 0, fragments: [], skipped: true, reason: "empty_session" };
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
- summary는 반드시 포함 (최소 1개 항목).
- 검색 패턴이나 도구 사용 패턴에서 학습할 수 있는 인사이트가 있다면, 해당 항목 앞에 "LEARNING:" 접두사를 붙여라. 예: "LEARNING: keyword recall이 topic 필터와 함께 사용하면 정확도가 높아진다"`;

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

  /** searchPaths 통계 기반 최소 학습 생성 */
  const searchPaths = activity.searchPaths || [];
  if (searchPaths.length >= 3) {
    const l3Count = searchPaths.filter(p => p.includes("L3")).length;
    const l3Rate  = l3Count / searchPaths.length;
    if (l3Rate > 0.5) {
      try {
        const learningFrag = await mgr.remember({
          content   : `L3(시맨틱) 검색 비율 ${(l3Rate * 100).toFixed(0)}%: 키워드 정확도가 낮아 벡터 검색 의존도가 높음. 키워드 품질 개선 필요.`,
          topic     : "search_pattern",
          type      : "fact",
          importance: 0.4,
          source    : "learning_extraction",
          agentId
        });
        if (reflectResult.fragments) {
          reflectResult.fragments.push({ id: learningFrag.id, content: learningFrag.content, type: "fact", source: "learning_extraction" });
          reflectResult.count = (reflectResult.count || 0) + 1;
        }
      } catch { /* learning 생성 실패 무시 */ }
    }

    const topTool = Object.entries(activity.toolCalls || {}).sort((a, b) => b[1] - a[1])[0];
    if (topTool && topTool[1] >= 5) {
      try {
        const toolLearning = await mgr.remember({
          content   : `세션 내 ${topTool[0]} 도구를 ${topTool[1]}회 호출: 반복 패턴 감지. 자동화 또는 배치 처리 검토 권장.`,
          topic     : "tool_pattern",
          type      : "fact",
          importance: 0.4,
          source    : "learning_extraction",
          agentId
        });
        if (reflectResult.fragments) {
          reflectResult.fragments.push({ id: toolLearning.id, content: toolLearning.content, type: "fact", source: "learning_extraction" });
          reflectResult.count = (reflectResult.count || 0) + 1;
        }
      } catch { /* learning 생성 실패 무시 */ }
    }
  }

  await SessionActivityTracker.markReflected(sessionId);
  logInfo(`[AutoReflect] Minimal reflect completed for ${sessionId}: ${reflectResult.count} fragments`);
  return reflectResult;
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

export { _isEmptySession, MIN_SESSION_DURATION_MS };
