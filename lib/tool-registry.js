/**
 * 도구 레지스트리 (Memory Only)
 *
 * memento-mcp: 기억 도구 18개 등록
 */

import {
  tool_remember,
  tool_batchRemember,
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
  tool_fragmentHistory,
  tool_getSkillGuide,
  tool_reconstructHistory,
  tool_searchTraces
} from "./tools/index.js";
import { tool_checkUpdate, tool_applyUpdate } from "./tools/update-tools.js";

export const TOOL_REGISTRY = new Map([
  ["remember",            { handler: tool_remember,            log: (args) => `Memory remember: topic=${args.topic}, type=${args.type}` }],
  ["batch_remember",      { handler: tool_batchRemember,       log: (args) => `Memory batch_remember: ${args.fragments?.length || 0} fragments` }],
  ["recall",              { handler: tool_recall,              log: (args) => `Memory recall: keywords=${Array.isArray(args.keywords) ? args.keywords.join(",") : (args.keywords || "")}, topic=${args.topic || ""}` }],
  ["forget",              { handler: tool_forget,              log: (args) => `Memory forget: id=${args.id || ""}, topic=${args.topic || ""}` }],
  ["link",                { handler: tool_link,                log: (args) => `Memory link: ${args.fromId} → ${args.toId}` }],
  ["amend",               { handler: tool_amend,               log: (args) => `Memory amend: id=${args.id}` }],
  ["reflect",             { handler: tool_reflect,             log: (args) => `Memory reflect: session=${args.sessionId || "unknown"}` }],
  ["context",             { handler: tool_context,             log: (_args, result) => `Memory context: ${result.count || 0} fragments loaded` }],
  ["tool_feedback",       { handler: tool_toolFeedback,        log: (args) => `Tool feedback: ${args.tool_name} relevant=${args.relevant} sufficient=${args.sufficient}` }],
  ["memory_stats",        { handler: tool_memoryStats,         log: () => "Memory stats retrieved" }],
  ["memory_consolidate",  { handler: tool_memoryConsolidate,   log: () => "Memory consolidation executed" }],
  ["graph_explore",       { handler: tool_graphExplore,        log: (args) => `RCA graph explore: startId=${args.startId}` }],
  ["fragment_history",    { handler: tool_fragmentHistory,     log: (args) => `Fragment history: id=${args.id}` }],
  ["get_skill_guide",     { handler: tool_getSkillGuide,       log: (args) => `Skill guide: section=${args.section || "full"}` }],
  ["reconstruct_history", { handler: tool_reconstructHistory,  log: (args) => `Reconstruct history: caseId=${args.caseId || ""} entity=${args.entity || ""}` }],
  ["search_traces",       { handler: tool_searchTraces,        log: (args) => `Search traces: keyword=${args.keyword || ""} case_id=${args.case_id || ""}` }],
  ["check_update",        { handler: tool_checkUpdate,         log: (_a, r) => `Update check: current=${r.currentVersion} latest=${r.latestVersion} available=${r.updateAvailable}` }],
  ["apply_update",        { handler: tool_applyUpdate,         log: (a, r) => `Update apply: step=${a.step} dryRun=${a.dryRun !== false} success=${r.success}` }],
]);
