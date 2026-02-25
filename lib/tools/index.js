/**
 * 도구 모듈 인덱스 (Memory Only)
 *
 * memento-mcp: 기억 도구만 포함
 */

/** 통계 */
export { accessStats, updateAccessStats, saveAccessStats } from "./stats.js";

/** 에이전트 기억 도구 핸들러 */
export {
  tool_remember,
  tool_recall,
  tool_forget,
  tool_link,
  tool_amend,
  tool_reflect,
  tool_context,
  tool_toolFeedback,
  tool_memoryStats,
  tool_memoryConsolidate,
  tool_graphExplore,
  rememberDefinition,
  recallDefinition,
  forgetDefinition,
  linkDefinition,
  amendDefinition,
  reflectDefinition,
  contextDefinition,
  toolFeedbackDefinition,
  memoryStatsDefinition,
  memoryConsolidateDefinition,
  graphExploreDefinition
} from "./memory.js";

import {
  rememberDefinition,
  recallDefinition,
  forgetDefinition,
  linkDefinition,
  amendDefinition,
  reflectDefinition,
  contextDefinition,
  toolFeedbackDefinition,
  memoryStatsDefinition,
  memoryConsolidateDefinition,
  graphExploreDefinition
} from "./memory.js";

/**
 * 도구 정의 목록 (tools/list 응답용)
 */
export function getToolsDefinition() {
  return [
    rememberDefinition,
    recallDefinition,
    forgetDefinition,
    linkDefinition,
    amendDefinition,
    reflectDefinition,
    contextDefinition,
    toolFeedbackDefinition,
    memoryStatsDefinition,
    memoryConsolidateDefinition,
    graphExploreDefinition
  ];
}
